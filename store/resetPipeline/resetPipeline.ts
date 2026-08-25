import type { AnyConfigNode } from "../store/types";
import type { Palistor } from "../store/palistor";
import { applyPatch } from "../applyPatch/applyPatch";
import { setGroupRevalidate, captureInitialValues } from "../dirtyTracking";
import { recomputeAndNotify } from "../compute/recompute";
import { buildResetPatch } from "./buildResetPatch";
import { resetFlowNavForSubtree } from "../flow/flowNavigation";
import { resetPagination } from "../pagination/paginationController";

/**
 * ResetPipeline — resets a group node's values.
 *
 * - When `values` is passed explicitly — applied as a patch (new baseline → dirty = false).
 * - Otherwise the initial snapshot is restored (or config defaults as a
 *   fallback), optionally transformed by the group's reset function.
 *
 * After the reset:
 * - revalidate = false (validation mode cleared)
 * - full recompute of computed props + subscriber notification
 */
export class ResetPipeline {
  constructor(private readonly kernel: Palistor<any, any>) {}

  execute(groupNode: AnyConfigNode, values?: Record<string, unknown>): void {
    const nodeState = this.kernel.nodes.nodeState;
    const initialValueMap = this.kernel.dirty.initialValueMap;
    const valuesCache = this.kernel.values;

    // On a full form reset, clear entity-field resolve states so they run
    // again when entities are loaded through the list resolver. A PAGINATED
    // nested list keeps its state: its page cache survives the reset (per-page
    // rollback, zero network), so its resolve state — status, settled dep set,
    // cycle counter — must survive with it, or the next read would refetch a
    // fresh cached window and the owner-field retrigger would go blind.
    if (groupNode === this.kernel.rootConfig) {
      const entityStates = this.kernel.resolveManager.entityStates;
      const kept: Array<{ ownerId: string; node: object; state: import("../resolvePipeline").ResolveState }> = [];
      this.kernel.entityRegistry.forEachEntityList((owner, ls) => {
        if (!ls.pagination) return;
        const ownerId = String(
          (nodeState.get(owner.id as object) as { value?: unknown } | undefined)?.value ?? owner.id.value,
        );
        const state = entityStates.get(ownerId, ls.listConfigNode);
        if (state) kept.push({ ownerId, node: ls.listConfigNode, state });
      });
      entityStates.clearAll();
      for (const k of kept) entityStates.set(k.ownerId, k.node, k.state);
    }

    const patch = buildResetPatch(groupNode, initialValueMap, values);

    const changed = applyPatch(groupNode, nodeState, patch, new Set(), valuesCache);

    // On a full reset, restore per-entity list membership to initial and bump
    // their EntityListState versions → React redraws the lists. The owner's
    // projectionObj is re-synced so getValues() returns the initial state.
    if (groupNode === this.kernel.rootConfig) {
      for (const { owner, state } of this.kernel.entityRegistry.resetEntityListStates()) {
        // A paginated nested instance rolls back per cached page, like a
        // paginated root list (edits undone, navigation and cache kept).
        if (state.pagination) {
          resetPagination(state);
          changed.add(owner as unknown as object);
        }
        this.kernel.syncListValuesCache(state);
        changed.add(state as unknown as object);
      }
      // Paginated root lists: per-page rollback — EDITS are undone, not
      // navigation (pointer and cache kept, in-flight results discarded, the
      // resolve state stays `resolved` so nothing lazily refetches). Zero network.
      for (const ls of this.kernel.nodes.allListStates) {
        if (ls.ownerEntity !== null || !ls.pagination) continue;
        resetPagination(ls);
        this.kernel.syncListValuesCache(ls);
        changed.add(ls as unknown as object);
        changed.add(ls.listConfigNode as object);
      }
    }

    if (values !== undefined && initialValueMap) {
      captureInitialValues(groupNode, nodeState, initialValueMap);
    }

    const revalidateChanged = setGroupRevalidate(groupNode, false, nodeState);
    for (const n of revalidateChanged) changed.add(n);

    recomputeAndNotify(
      changed,
      () => this.kernel.recompute(),
      (c) => this.kernel.notifyChanged(c),
    );

    // Flow: reset flow navigation inside the reset subtree — the first step is
    // active again, step resolve states go idle, and the first step's entry
    // lifecycle runs anew.
    resetFlowNavForSubtree(this.kernel, groupNode);
  }
}
