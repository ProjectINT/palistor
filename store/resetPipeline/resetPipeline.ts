import type { AnyConfigNode } from "../store/types";
import type { Palistor } from "../store/palistor";
import { applyPatch } from "../applyPatch/applyPatch";
import { setGroupRevalidate, captureInitialValues } from "../dirtyTracking";
import { recomputeAndNotify } from "../compute/recompute";
import { buildResetPatch } from "./buildResetPatch";
import { resetFlowNavForSubtree } from "../flow/flowNavigation";

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
    // again when entities are loaded through the list resolver.
    if (groupNode === this.kernel.rootConfig) {
      this.kernel.resolveManager.entityStates.clearAll();
    }

    const patch = buildResetPatch(groupNode, initialValueMap, values);

    const changed = applyPatch(groupNode, nodeState, patch, new Set(), valuesCache);

    // On a full reset, restore per-entity list membership to initial and bump
    // their EntityListState versions → React redraws the lists. The owner's
    // projectionObj is re-synced so getValues() returns the initial state.
    if (groupNode === this.kernel.rootConfig) {
      for (const { state } of this.kernel.entityRegistry.resetEntityListStates()) {
        this.kernel.syncListValuesCache(state);
        changed.add(state as unknown as object);
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
