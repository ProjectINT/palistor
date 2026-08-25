import { type AnyConfigNode } from "../store/types";
import type { ListState } from "../store/types";
import type { FieldState } from "../compute/index";
import type { ValuesCache } from "../valuesCache/valuesCache";
import type { EntityData } from "../entityRegistry";
import type { EntityRegistry } from "../entityRegistry";
import type { EntityNode } from "../entityRegistry/types";
import { generateTmpId } from "../entityRegistry";
import { buildEntityValues } from "../buildProxy/buildEntityProjectionProxy";
import {
  type Resolve,
  type NotifyFn,
  type ResolveState,
  type ResolveDeps,
  type ListResolveDeps,
  type AnyResolveEntry,
  type TemplateFieldResolveEntry,
  type EntityFieldResolveDeps,
  EntityResolveStateMap,
  initResolveStates,
  executeResolve,
  executeListResolve,
  executeEntityFieldResolve,
  findResolvesToRetrigger,
  resetResolveState,
} from "../resolvePipeline/index";
import { isLeafNode } from "../traversal";
import { computeServerKey } from "../filtering/filterController";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ResolveManagerDeps {
  rootConfig: AnyConfigNode;
  nodeState: WeakMap<object, FieldState>;
  recompute: () => Set<object>;
  notifyChanged: (changed: Set<object>) => void;
  notify: NotifyFn;
  /** Initial values snapshot — passed to the resolve pipeline for dirty tracking. */
  initialValueMap: WeakMap<object, unknown>;
  valuesCache: ValuesCache;
  /** The ProxyStore instance — passed as the second resolver argument. */
  store: any;
  // ─── List specifics ──────────────────────────────────────────────────────
  /** All ListState objects from NodeRegistry (for list-resolve dispatch). */
  listStates: WeakMap<object, ListState>;
  /** All root ListStates in registration order (filter dep seeding / the invalidation gate). */
  allListStates?: ListState[];
  /**
   * Upserts entities and registers their leaves without calling notify.
   * Called from executeListResolve after a successful list resolver.
   * listNode is passed to trigger entity field resolves automatically.
   */
  setEntitiesRaw: (items: EntityData[], listNode?: object) => Set<object>;
  /**
   * Syncs valuesCache with the list membership (single method, root + entity).
   * Called from executeListResolve after itemIds is updated.
   */
  syncListValuesCache: (listState: ListState) => void;
  /**
   * The EntityRegistry instance — used by triggerEntityFieldResolve for the skipIfResolved check.
   */
  entityRegistry: EntityRegistry;
}

// ─── Class ───────────────────────────────────────────────────────────────────

/**
 * Manager of the resolve subsystem.
 *
 * Consolidates:
 * - Resolve state initialization (initResolveStates)
 * - triggerResolve / getResolveState
 * - The post-notify hook for dependency-driven re-triggers
 * - Launching eager resolvers (lazy: false)
 */
// ─── Constants ─────────────────────────────────────────────────────────────────

/**
 * Maximum number of consecutive automatic re-runs of one resolver
 * (via postNotifyHook). Exceeding it → warning and skip.
 * Guards against circular dependencies like A→B→A.
 */
const MAX_AUTO_RETRIGGERS = 10;

// ─── Helpers ────────────────────────────────────────────────────────────────

function isContextSatisfied(
  contextDeps: string[] | undefined,
  context: Record<string, unknown>,
): boolean {
  if (!contextDeps || contextDeps.length === 0) return true;
  return contextDeps.every((key) => context[key] != null);
}

// ─── Class ───────────────────────────────────────────────────────────────────

export class ResolveManager {
  /** Resolve states of all nodes with a resolve config. */
  readonly states = new Map<object, ResolveState>();

  /**
   * Per-entity resolve states.
   * - Per-field: (entityId, templateFieldNode) → ResolveState
   * - Per-template binding: (entityId, templateNode) → ResolveState
   *   where status === "pending" means loading, state.submitting === true means a form submit.
   */
  readonly entityStates = new EntityResolveStateMap();

  private readonly resolveEntries: AnyResolveEntry[];
  private readonly resolveEntryMap: Map<AnyConfigNode, AnyResolveEntry>;
  /** Template-field entries (per-entity field resolves). */
  readonly templateFieldEntries: TemplateFieldResolveEntry[];
  /** Fast lookup: templateFieldNode → TemplateFieldResolveEntry. */
  private readonly templateFieldEntryMap: Map<AnyConfigNode, TemplateFieldResolveEntry>;
  /** listNode → TemplateFieldResolveEntry[] (for triggering on entity creation). */
  readonly listNodeToTemplateFieldEntries: Map<AnyConfigNode, TemplateFieldResolveEntry[]>;
  private readonly resolveDeps: ResolveDeps;
  private readonly listResolveDeps: ListResolveDeps;
  private readonly listStates: WeakMap<object, ListState>;
  private readonly entityRegistry: EntityRegistry;
  /** Entries waiting for their contextDeps to be satisfied before launching. */
  private readonly pendingContextQueue = new Set<AnyResolveEntry>();
  /**
   * SERVER filter-field dep path → owning root ListState. A filter is owned by
   * exactly one list, so a server-field change invalidates its own list
   * directly (through the debounce gate) instead of by generic path matching.
   */
  private readonly filterServerPathIndex = new Map<string, ListState>();

  constructor(deps: ResolveManagerDeps) {
    const {
      rootConfig, nodeState, recompute, notifyChanged, notify,
      initialValueMap, valuesCache, store,
      listStates, allListStates = [], setEntitiesRaw, syncListValuesCache, entityRegistry,
    } = deps;

    this.listStates = listStates;
    this.entityRegistry = entityRegistry;
    const allEntries = initResolveStates(rootConfig, this.states);
    this.templateFieldEntries = allEntries.filter(
      (e): e is TemplateFieldResolveEntry => (e as TemplateFieldResolveEntry).isTemplateField === true,
    );
    this.resolveEntries = allEntries.filter((e) => !(e as TemplateFieldResolveEntry).isTemplateField);
    this.resolveEntryMap = new Map(this.resolveEntries.map((e) => [e.node, e]));

    // Build fast-access maps for template-field entries
    this.templateFieldEntryMap = new Map(
      this.templateFieldEntries.map((e) => [e.node, e]),
    );
    this.listNodeToTemplateFieldEntries = new Map();
    for (const entry of this.templateFieldEntries) {
      const listNode = entry.listNode;
      let arr = this.listNodeToTemplateFieldEntries.get(listNode);
      if (!arr) {
        arr = [];
        this.listNodeToTemplateFieldEntries.set(listNode, arr);
      }
      arr.push(entry);
    }

    // Declared filters: seed SERVER field paths into the list's resolver deps
    // BEFORE run 1 (filters have no auto-dep bootstrap gap) and index them for
    // the invalidation gate in the post-notify hook.
    for (const ls of allListStates) {
      const fs = ls.filter;
      if (!fs || fs.serverPaths.size === 0) continue;
      const state = this.states.get(ls.listConfigNode);
      if (state) {
        for (const p of fs.serverPaths) state.dependencies.add(p);
      }
      for (const p of fs.serverPaths) this.filterServerPathIndex.set(p, ls);
    }

    this.resolveDeps = {
      rootConfig,
      nodeState,
      resolveStates: this.states,
      recompute,
      notifyChanged,
      notify,
      getValues: () => {
        const clone = structuredClone(valuesCache.values) as Record<string, unknown>;
        // The resolver's `values` argument never sees filters — ctx.filter is the one way in.
        delete clone["$filters"];
        return clone;
      },
      initialValueMap,
      valuesCache,
      store,
    };

    this.listResolveDeps = {
      ...this.resolveDeps,
      setEntitiesRaw,
      syncListValuesCache,
    };
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Run resolve for a specific node (if it has a resolve config).
   * Arrow function — keeps `this` when destructured/passed as a callback.
   */
  triggerResolve = (node: AnyConfigNode): void => {
    const entry = this.resolveEntryMap.get(node);
    if (!entry) return;
    // A manual trigger resets the auto-retrigger counter
    const state = this.states.get(node as object);
    if (state) state.autoRetriggerCount = 0;
    this._executeEntry(entry);
  };

  /**
   * Get the current resolve state of a node.
   * Arrow function — keeps `this` when destructured/passed as a callback.
   */
  getResolveState = (node: AnyConfigNode): ResolveState | undefined => {
    return this.states.get(node as object);
  };

  // ─── Entity field resolve ──────────────────────────────────────────────────

  /**
   * Run a per-entity field resolve for a specific entity and template field.
   *
   * Logic:
   * 1. Find the TemplateFieldResolveEntry by templateFieldNode
   * 2. getOrCreate a ResolveState in entityStates
   * 3. skipIfResolved: when the entity leaf already has a value ≠ template default → skip
   * 4. Deduplication: when status === "pending" → return
   * 5. Call _executeEntityFieldEntry
   */
  triggerEntityFieldResolve(entityId: string, templateFieldNode: AnyConfigNode): void {
    const entry = this.templateFieldEntryMap.get(templateFieldNode);
    if (!entry) return;

    const state = this.entityStates.getOrCreate(
      entityId,
      templateFieldNode as object,
      new Set(entry.resolve.deps ?? []),
    );

    // skipIfResolved check: the entity leaf already has a value ≠ template default
    const skipIfResolved = entry.resolve.options?.skipIfResolved ?? true;
    if (skipIfResolved) {
      const entityNode = this.entityRegistry.get(entityId);
      if (entityNode) {
        const entityLeaf = entityNode[entry.fieldKey] as { value: unknown } | undefined;
        const templateDefault = (entry.node as AnyConfigNode).value;
        if (
          entityLeaf &&
          isLeafNode(entityLeaf as object) &&
          entityLeaf.value !== templateDefault &&
          entityLeaf.value !== undefined &&
          entityLeaf.value !== null
        ) {
          // Already differs from the default — mark resolved and skip
          if (state.status === "idle") {
            state.status = "resolved";
          }
          return;
        }
      }
    }

    // Deduplication: already running
    if (state.status === "pending") return;

    this._executeEntityFieldEntry(entry, entityId);
  }

  /**
   * Run resolve for an entity-template binding.
   *
   * - Checks that templateNode.resolve.resolver exists
   * - Deduplication: skipped when already loading (status === "pending")
   * - status "pending" → resolver(entityProxy, store) → upsert result → markResolved → status "resolved"
   * - On error: onError → status "error"
   */
  triggerEntityTemplateResolve(
    entityId: string,
    templateNode: AnyConfigNode,
    entityProxy: object,
  ): void {
    const resolve = templateNode.resolve as
      | {
          resolver?: (...args: unknown[]) => unknown;
          onError?: (...args: unknown[]) => void;
        }
      | undefined;
    if (!resolve || typeof resolve.resolver !== "function") return;

    const entityNode = this.entityRegistry.get(entityId);
    if (!entityNode) return;

    const bindingState = this.entityStates.getOrCreate(entityId, templateNode as object);
    if (bindingState.status === "pending") return;

    const entityNodeObj = entityNode as unknown as object;
    bindingState.status = "pending";
    this.resolveDeps.notifyChanged(new Set<object>([entityNodeObj]));

    void (async () => {
      try {
        const result = await resolve.resolver!(entityProxy, this.resolveDeps.store);
        bindingState.status = "resolved";

        if (result && typeof result === "object") {
          const changed = this.listResolveDeps.setEntitiesRaw([result as EntityData]);
          this.entityRegistry.markResolved(entityId, templateNode as object);
          changed.add(entityNodeObj);
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call
          const recomputed = (this.resolveDeps.store as any).recompute(changed) as Set<object>;
          for (const n of changed) recomputed.add(n);
          this.resolveDeps.notifyChanged(recomputed);
        } else {
          this.entityRegistry.markResolved(entityId, templateNode as object);
          this.resolveDeps.notifyChanged(new Set<object>([entityNodeObj]));
        }
      } catch (err) {
        bindingState.status = "error";
        try {
          (resolve.onError as ((e: unknown, ctx: { notify: NotifyFn }) => void) | undefined)?.(
            err,
            { notify: this.resolveDeps.notify },
          );
        } catch {
          // swallow onError failures
        }
        this.resolveDeps.notifyChanged(new Set<object>([entityNodeObj]));
      }
    })();
  }

  /**
   * Run resolve for a per-entity nested list.
   *
   * The resolve state lives in the shared `entityStates`, keyed by
   * (ownerId, listConfigNode). The list membership lives in the
   * `EntityListState` (on `ownerEntity.lists`), whose identity serves as the
   * isolated version key in the hub.
   *
   * - Checks `listConfigNode[1].resolve.resolver`.
   * - Deduplication: skipped when already `pending`/`resolved`.
   * - `pending` → resolver(parentValues, store) → upsert children with the
   *   owner reference → update `EntityListState.itemIds` → notify (bump the
   *   entityListState version).
   * - On error: onError → status `error`.
   *
   * @param force — ignore the `resolved` dedup and re-run (used by
   *   `list.reload()`). `pending` still dedups on the forced path: a reload
   *   during an in-flight run must not spawn a parallel one.
   */
  triggerEntityListResolve(
    ownerId: string,
    listConfigNode: AnyConfigNode,
    ownerEntity: EntityNode,
    force = false,
  ): void {
    const listConfig = Array.isArray(listConfigNode)
      ? (listConfigNode[1] as { resolve?: { resolver?: (...a: unknown[]) => unknown; onError?: (...a: unknown[]) => void; deps?: string[] } } | undefined)
      : undefined;
    const resolve = listConfig?.resolve;
    if (!resolve || typeof resolve.resolver !== "function") return;

    const entityListState = this.entityRegistry.getOrCreateEntityListState(
      ownerEntity,
      listConfigNode as object,
    ) as unknown as object;

    const state = this.entityStates.getOrCreate(
      ownerId,
      listConfigNode as object,
      new Set(resolve.deps ?? []),
    );
    // Deduplication: already running (never bypassed — a forced reload must
    // not spawn a parallel run) or completed (bypassed by `force`; there is no
    // deps-driven re-resolve on this path).
    if (state.status === "pending") return;
    if (!force && state.status === "resolved") return;

    state.status = "pending";
    // Cleared alongside the status so `list.error`/`list.resolveStatus` stay a
    // coherent pair while the re-run is in flight.
    state.error = null;
    this.resolveDeps.notifyChanged(new Set<object>([entityListState]));

    void (async () => {
      try {
        // The resolver receives a flat snapshot of the OWNER (not a projection proxy).
        const parentValues = buildEntityValues(
          ownerEntity,
          this.resolveDeps.nodeState as WeakMap<object, { value: unknown }>,
        );
        const result = await resolve.resolver!(parentValues, this.resolveDeps.store);
        state.status = "resolved";

        const items = Array.isArray(result) ? (result as EntityData[]) : [];
        const changed = new Set<object>();

        // Fix ids upfront (stable for items without an id), then ingest.
        const ids: string[] = [];
        const itemsWithIds: EntityData[] = items.map((item) => {
          const rawId = item.id;
          const id =
            typeof rawId === "string" && rawId.trim() !== "" ? rawId : generateTmpId();
          ids.push(id);
          return { ...item, id };
        });

        if (itemsWithIds.length > 0) {
          const entityChanged = this.listResolveDeps.setEntitiesRaw(itemsWithIds);
          for (const n of entityChanged) changed.add(n);
          // Set the owner reference on every child + index it.
          for (const id of ids) {
            const childNode = this.entityRegistry.get(id);
            if (childNode) {
              this.entityRegistry.setEntityOwner(childNode, ownerId, listConfigNode as object);
            }
          }
        }

        const els = this.entityRegistry.getOrCreateEntityListState(
          ownerEntity,
          listConfigNode as object,
        );
        els.itemIds = ids;
        els.initialItemIds = [...ids];

        // Materialize the membership into the owner's projectionObj (for getValues).
        (this.resolveDeps.store as any).syncListValuesCache(els);

        changed.add(entityListState);
        const recomputed = (this.resolveDeps.store as any).recompute(changed) as Set<object>;
        for (const n of changed) recomputed.add(n);
        this.resolveDeps.notifyChanged(recomputed);
      } catch (err) {
        state.status = "error";
        // Mirrors executeListResolve: the public `list.error` projection reads
        // this field for root and per-entity lists alike.
        state.error = err;
        try {
          (resolve.onError as ((e: unknown, ctx: { notify: NotifyFn }) => void) | undefined)?.(
            err,
            { notify: this.resolveDeps.notify },
          );
        } catch {
          // swallow onError failures
        }
        this.resolveDeps.notifyChanged(new Set<object>([entityListState]));
      }
    })();
  }

  /** Current owner id (accounts for rekey via nodeState). */
  private _listOwnerId(ownerEntity: EntityNode): string {
    const idLeaf = ownerEntity.id as object;
    const ns = this.resolveDeps.nodeState as WeakMap<object, { value: unknown }>;
    return ((ns.get(idLeaf)?.value) ?? ownerEntity.id.value) as string;
  }

  /**
   * Single read point for a list's resolve state (root + per-entity).
   *
   * Gives the builder/loading one source without knowing where the state
   * physically lives:
   *   - root  → `this.states` (keyed by listConfigNode);
   *   - entity→ `this.entityStates` (keyed by (ownerId, listConfigNode)).
   *
   * The two stores are deliberately not merged: root-list states are coupled
   * to the shared `this.states` (deps re-trigger/reset), and extracting them
   * costs more than it gains. Unification here is at the access level.
   */
  getListResolveState(listState: ListState): ResolveState | undefined {
    if (listState.ownerEntity === null) {
      return this.states.get(listState.listConfigNode);
    }
    const ownerId = this._listOwnerId(listState.ownerEntity);
    return this.entityStates.get(ownerId, listState.listConfigNode);
  }

  /**
   * Single trigger point for a list resolve (root + per-entity).
   * Dispatches by `ownerEntity` onto the existing bodies
   * ({@link triggerResolve} → executeListResolve / {@link triggerEntityListResolve}).
   *
   * @param force — bypass the `resolved` dedup (see
   *   {@link triggerEntityListResolve}). The root path needs no flag:
   *   `executeListResolve` dedups on `pending` only, so it already re-runs from
   *   `resolved`/`error`.
   */
  triggerListResolve(listState: ListState, force = false): void {
    if (listState.ownerEntity === null) {
      this.triggerResolve(listState.listConfigNode as AnyConfigNode);
      return;
    }
    const ownerId = this._listOwnerId(listState.ownerEntity);
    this.triggerEntityListResolve(
      ownerId,
      listState.listConfigNode as AnyConfigNode,
      listState.ownerEntity,
      force,
    );
  }

  /**
   * Clear all per-entity resolve states for a deleted entity.
   * Called from Palistor.delete(entityId).
   */
  cleanupEntityResolveStates(entityId: string): void {
    this.entityStates.delete(entityId);
  }

  /**
   * Wire the resolve re-trigger into the notification hub.
   * Returns the `(changedPaths) => void` hook to install via
   * `hub.setPostNotifyHook`.
   * Returns `null` when there are no resolve entries.
   */
  createPostNotifyHook(): ((changedPaths: Set<string>) => void) | null {
    if (this.resolveEntries.length === 0 && this.templateFieldEntries.length === 0) return null;

    return (changedPaths: Set<string>) => {
      // ── Filter invalidation gate ─────────────────────────────────────────
      // Server filter-field changes are routed to their owning list directly,
      // ahead of (and excluded from) the generic dep matching — otherwise the
      // seeded serverPaths would re-trigger the list immediately and bypass
      // the per-field debounce. Client-field paths appear in no dep set at
      // all, by construction.
      let effectivePaths = changedPaths;
      if (this.filterServerPathIndex.size > 0) {
        let touched: Map<ListState, string[]> | null = null;
        for (const p of changedPaths) {
          const ls = this.filterServerPathIndex.get(p);
          if (!ls) continue;
          touched ??= new Map();
          const arr = touched.get(ls);
          if (arr) arr.push(p);
          else touched.set(ls, [p]);
        }
        if (touched) {
          effectivePaths = new Set(changedPaths);
          for (const [ls, paths] of touched) {
            for (const p of paths) effectivePaths.delete(p);
            this._scheduleFilterInvalidation(ls, paths);
          }
        }
      }

      const toRetrigger = findResolvesToRetrigger(
        effectivePaths,
        this.states,
        this.resolveEntries,
      );

      // Track the nodes just triggered so we don't mark them pendingRetrigger
      // in the same tick (they already have the new dependency value).
      const justTriggeredNodes = new Set<object>(toRetrigger.map((e) => e.node as object));

      for (const entry of toRetrigger) {
        const state = this.states.get(entry.node as object);
        if (state) {
          const count = (state.autoRetriggerCount ?? 0) + 1;
          if (count > MAX_AUTO_RETRIGGERS) {
            console.warn(
              `Palistor: resolver auto-retrigger cap (${MAX_AUTO_RETRIGGERS}) reached. ` +
              `Possible circular dependency. Node deps: [${[...state.dependencies].join(", ")}]`,
            );
            continue;
          }
          state.autoRetriggerCount = count;
        }
        resetResolveState(entry.node as AnyConfigNode, this.states);
        this._executeEntry(entry);
      }

      // Mark resolvers that were ALREADY pending (not just triggered) whose
      // dependencies changed — they re-run after the current resolution
      // completes. Filter paths are excluded here too: the gate owns them
      // (it marks pendingRetrigger itself when the debounce flushes).
      for (const entry of this.resolveEntries) {
        if (justTriggeredNodes.has(entry.node as object)) continue;
        const state = this.states.get(entry.node as object);
        if (!state || state.status !== "pending") continue;
        for (const dep of state.dependencies) {
          if (effectivePaths.has(dep)) {
            state.pendingRetrigger = true;
            break;
          }
        }
      }

      // Re-trigger entity field resolves when entity paths change.
      if (this.templateFieldEntries.length > 0) {
        this._retriggerEntityFieldResolves(changedPaths);
      }
    };
  }

  // ─── Filter invalidation gate ──────────────────────────────────────────────

  /**
   * Debounce gate for server filter-field changes. The field value has ALREADY
   * updated synchronously (inputs never lag; computed props and the client
   * projection see it immediately) — what is delayed is the ISSUE.
   *
   * - The timer is armed with the max `debounce` of the changed fields; an
   *   undebounced change (or `set`/`reset`/`clear` via `forceImmediate`)
   *   flushes immediately, carrying every debounced field's CURRENT value.
   * - The trailing edge re-reads the current serverKey — never a value
   *   captured at arm time — and issues iff it differs from `issuedKey`.
   * - The first resolve is never debounced: it goes through the normal
   *   lazy/eager trigger, not through this gate.
   */
  private _scheduleFilterInvalidation(listState: ListState, changedPaths: string[]): void {
    const fs = listState.filter;
    if (!fs) return;
    // Without a resolver there is nothing to issue (an all-client or
    // resolver-less list) — and nothing to debounce.
    if (!this.resolveEntryMap.has(listState.listConfigNode as AnyConfigNode)) return;

    let delay = 0;
    if (!fs.forceImmediate) {
      let sawUndebounced = false;
      for (const p of changedPaths) {
        const rt = fs.fieldsByPath.get(p);
        if (!rt || rt.isClient || rt.isDerived) continue;
        if (rt.debounce && rt.debounce > 0) delay = Math.max(delay, rt.debounce);
        else sawUndebounced = true;
      }
      // One request per list, carrying the whole params object: an undebounced
      // change flushes NOW and includes the debounced fields' current values.
      if (sawUndebounced) delay = 0;
    }

    if (delay > 0) {
      const wasPending = fs.pendingTimer !== null;
      if (fs.pendingTimer) clearTimeout(fs.pendingTimer);
      fs.pendingTimer = setTimeout(() => {
        fs.pendingTimer = null;
        this._notifyFilterState(listState);
        this._flushFilterInvalidation(listState);
      }, delay);
      // isPending flipped false → true: bump the list's version for tracking.
      if (!wasPending) this._notifyFilterState(listState);
      return;
    }

    if (fs.pendingTimer) {
      clearTimeout(fs.pendingTimer);
      fs.pendingTimer = null;
      this._notifyFilterState(listState);
    }
    this._flushFilterInvalidation(listState);
  }

  /**
   * Issue the invalidation iff the current serverKey differs from the last
   * issued one (`serverKey === issuedKey` is the whole arbitration: reverted
   * values, mixed debounces and already-flushed patches all decline here).
   *
   * Public for `filter.set()/reset()/clear()`: they flush any pending timer
   * and must not lose a queued debounced change.
   */
  flushFilterInvalidation(listState: ListState): void {
    this._flushFilterInvalidation(listState);
  }

  private _flushFilterInvalidation(listState: ListState): void {
    const fs = listState.filter;
    if (!fs) return;
    const entry = this.resolveEntryMap.get(listState.listConfigNode as AnyConfigNode);
    const state = this.states.get(listState.listConfigNode);
    if (!entry || !state) return;

    const currentKey = computeServerKey(fs, this.resolveDeps.nodeState);
    fs.serverKey = currentKey;
    if (currentKey === fs.issuedKey) return;

    // idle = lazy resolve never started — the first run reads current values anyway.
    if (state.status === "idle") return;
    if (state.status === "pending") {
      // Re-run after the in-flight resolution completes (existing mechanism);
      // that re-run recomputes the serverKey at its own launch.
      state.pendingRetrigger = true;
      return;
    }

    // Same auto-retrigger cap the generic dep path applies.
    const count = (state.autoRetriggerCount ?? 0) + 1;
    if (count > MAX_AUTO_RETRIGGERS) {
      console.warn(
        `Palistor: resolver auto-retrigger cap (${MAX_AUTO_RETRIGGERS}) reached ` +
          `for filtered list. Possible circular dependency.`,
      );
      return;
    }
    state.autoRetriggerCount = count;
    resetResolveState(entry.node as AnyConfigNode, this.states);
    this._executeEntry(entry);
  }

  /** Bump the list's version (isPending and friends) — reentrancy-safe via the hub. */
  private _notifyFilterState(listState: ListState): void {
    this.resolveDeps.notifyChanged(new Set<object>([listState as unknown as object]));
  }

  /**
   * Parses entity paths out of changedPaths and re-triggers entity field
   * resolves whose dependencies intersect the changed field paths.
   *
   * Entity paths look like `_entity_.${entityId}.${fieldPath}`.
   * Dependencies in entityStates are stored relative to the entity
   * (e.g. "name", not "_entity_.u1.name").
   */
  private _retriggerEntityFieldResolves(changedPaths: Set<string>): void {
    // Parse entity paths: build the entityId → Set<changedFieldPath> map
    const entityChanges = new Map<string, Set<string>>();
    for (const path of changedPaths) {
      if (!path.startsWith("_entity_.")) continue;
      const withoutPrefix = path.slice("_entity_.".length);
      const dotIndex = withoutPrefix.indexOf(".");
      if (dotIndex === -1) continue;
      const entityId = withoutPrefix.slice(0, dotIndex);
      const fieldPath = withoutPrefix.slice(dotIndex + 1);
      let fields = entityChanges.get(entityId);
      if (!fields) {
        fields = new Set();
        entityChanges.set(entityId, fields);
      }
      fields.add(fieldPath);
    }

    if (entityChanges.size === 0) return;

    for (const [entityId, changedFields] of entityChanges) {
      for (const entry of this.templateFieldEntries) {
        const state = this.entityStates.get(entityId, entry.node as object);
        if (!state) continue;

        if (state.status === "resolved" || state.status === "error") {
          // Any dependency changed → re-run
          let shouldRetrigger = false;
          for (const dep of state.dependencies) {
            if (changedFields.has(dep)) {
              shouldRetrigger = true;
              break;
            }
          }
          if (shouldRetrigger) {
            // Reset the state to idle and execute directly (bypassing
            // skipIfResolved — this is a dependency-driven re-run, not an initial load).
            state.status = "idle";
            state.pendingRetrigger = false;
            this._executeEntityFieldEntry(entry, entityId);
          }
        } else if (state.status === "pending") {
          // Mark pendingRetrigger to re-run after the current resolve completes
          for (const dep of state.dependencies) {
            if (changedFields.has(dep)) {
              state.pendingRetrigger = true;
              break;
            }
          }
        }
      }
    }
  }

  /** Launch eager resolvers (lazy: false). */
  launchEager(): void {
    for (const entry of this.resolveEntries) {
      const lazy = entry.resolve?.options?.lazy ?? true;
      if (!lazy) {
        this._executeEntry(entry);
      }
    }
  }

  /**
   * Re-trigger resolvers that depend on the changed paths.
   * Used by `Palistor.setContext()` to reactively re-run resolvers on
   * context changes.
   */
  retriggerByPaths(changedPaths: Set<string>): void {
    if (changedPaths.size === 0) return;

    const toRetrigger = findResolvesToRetrigger(
      changedPaths,
      this.states,
      this.resolveEntries,
    );

    for (const entry of toRetrigger) {
      // setContext is an explicit external change — reset the auto-retrigger counter
      const state = this.states.get(entry.node as object);
      if (state) state.autoRetriggerCount = 0;
      resetResolveState(entry.node as AnyConfigNode, this.states);
      this._executeEntry(entry);
    }

    // Flush the deferred queue: launch entries whose contextDeps are now satisfied
    for (const entry of this.pendingContextQueue) {
      const resolve = entry.resolve as Resolve | undefined;
      if (isContextSatisfied(resolve?.contextDeps, this.resolveDeps.store.context)) {
        this.pendingContextQueue.delete(entry);
        this._executeEntry(entry);
      }
    }
  }

  // ─── Internal dispatch ───────────────────────────────────────────────────────

  /** Dispatches an entry to the right execution function (group or list). */
  private _executeEntry(entry: AnyResolveEntry): void {
    // Launch condition: when contextDeps are not satisfied — defer into the queue
    const resolve = entry.resolve as Resolve | undefined;
    if (!isContextSatisfied(resolve?.contextDeps, this.resolveDeps.store.context)) {
      this.pendingContextQueue.add(entry);
      return;
    }

    if (entry.isListNode) {
      const listState = this.listStates.get(entry.node as object);
      if (listState && entry.resolve) {
        executeListResolve(
          entry.node as object,
          entry.resolve as import("../store/types").ListResolveConfig,
          listState,
          this.listResolveDeps,
        );
      }
    } else {
      executeResolve(
        (entry as { node: AnyConfigNode; resolve: Resolve }).node,
        (entry as { node: AnyConfigNode; resolve: Resolve }).resolve,
        this.resolveDeps,
      );
    }
  }

  /**
   * Executes the entity field resolve for a given entry + entityId.
   * Delegates to executeEntityFieldResolve with per-entity ResolveDeps.
   */
  private _executeEntityFieldEntry(
    entry: TemplateFieldResolveEntry,
    entityId: string,
  ): void {
    const entityNode = this.entityRegistry.get(entityId);
    if (!entityNode) return;

    const entityFieldDeps: EntityFieldResolveDeps = {
      ...this.resolveDeps,
      entityStates: this.entityStates,
    };

    executeEntityFieldResolve(entityId, entry, entityNode, entityFieldDeps);
  }
}

// ─── Deprecated factory alias ────────────────────────────────────────────────

/** @deprecated Use `new ResolveManager(deps)`. */
export function createResolveManager(deps: ResolveManagerDeps): ResolveManager {
  return new ResolveManager(deps);
}
