import type { EntityData } from "../entityRegistry";
import type { ListResolveConfig, ListState } from "../store/types";
import { recomputeAndNotify } from "../compute/recompute";
import { createContextTrackingProxy } from "./createContextTrackingProxy";
import type { ContextTrackingResult } from "./createContextTrackingProxy";
import { createValuesTrackingProxy } from "./createValuesTrackingProxy";
import type { ResolveDeps } from "./types";

// ─── List-specific deps ──────────────────────────────────────────────────────

/**
 * Extra dependencies for executeListResolve.
 * Extends ResolveDeps with list-specific callbacks.
 */
export interface ListResolveDeps extends ResolveDeps {
  /**
   * Upsert entities into EntityRegistry + register leaf nodes.
   * Does not call recompute/notifyChanged — those run afterwards.
   * Returns the Set of changed leaf nodes.
   * listNode is passed to trigger entity field resolves automatically.
   */
  setEntitiesRaw: (items: EntityData[], listNode?: object) => Set<object>;

  /**
   * Sync valuesCache with the list membership (single method, root + entity).
   * Called after listState.itemIds is updated.
   */
  syncListValuesCache: (listState: ListState) => void;
}

// ─── Default nodeState for listNode ─────────────────────────────────────────

const DEFAULT_LIST_STATE = {
  value: undefined,
  isVisible: true,
  isRequired: false,
  isDisabled: false,
  isReadOnly: false,
  loading: false,
  dirty: false,
  revalidate: false,
} as const;

// ─── executeListResolve ──────────────────────────────────────────────────────

/**
 * Run resolve for a ListNode.
 *
 * Differs from executeResolve (for groups):
 * - the resolver returns Array<EntityData> instead of Record<string, unknown>
 * - the result → entity upserts + listState.itemIds update
 * - initialItemIds is updated on success → dirty = false after resolve
 * - loading state is kept in nodeState for the listNode (created on the fly)
 */
export function executeListResolve(
  listNode: object,
  resolve: ListResolveConfig,
  listState: ListState,
  deps: ListResolveDeps,
): Promise<unknown> {
  const {
    nodeState,
    resolveStates,
    recompute,
    notifyChanged,
    notify,
    setEntitiesRaw,
    syncListValuesCache,
    store,
  } = deps;

  const state = resolveStates.get(listNode);
  if (!state) return Promise.resolve();

  // Deduplication
  if (state.status === "pending" && state.promise) {
    return state.promise;
  }

  state.status = "pending";
  state.attempt = 0;
  state.error = null;

  // Set loading = true in nodeState for the listNode
  const nodeSt = nodeState.get(listNode);
  nodeState.set(listNode, { ...(nodeSt ?? DEFAULT_LIST_STATE), loading: true });

  // Notify about loading: true.
  // Bump both the ListState (the tracking key) and the listNode (bridge for tests).
  const loadingChanged = new Set<object>([listNode, listState as object]);
  recomputeAndNotify(loadingChanged, recompute, notifyChanged);

  const promise = (async (): Promise<unknown> => {
    let contextTracking: ContextTrackingResult | null = null;
    let valuesTracking: ReturnType<typeof createValuesTrackingProxy> | null = null;

    try {
      // Call the resolver with a snapshot of current values through a tracking
      // proxy, so dependencies (deps) are registered automatically
      const { getValues } = deps;
      const freshValues = getValues();
      valuesTracking = createValuesTrackingProxy(freshValues);

      // Wrap store.context in a tracking proxy for automatic context dependencies
      contextTracking = createContextTrackingProxy(store.context);
      const storeProxy = new Proxy(store, {
        get(target, key) {
          if (key === "context") return contextTracking!.proxy;
          return (target as any)[key];
        },
      });

      const result = await resolve.resolver(valuesTracking.proxy, storeProxy);

      // Abort when the status changed while awaiting (e.g. a reset)
      if (state.status !== "pending") return result;

      // ── Success path ────────────────────────────────────────────────────
      // ListState is the tracking key; listNode is the backward-compat bridge.
      const changed = new Set<object>([listNode, listState as object]);

      if (Array.isArray(result) && result.length > 0) {
        // Upsert all entities (registers leaves, returns changed nodes).
        // Pass listNode so that entity field resolves are triggered automatically.
        const entityChanged = setEntitiesRaw(result as EntityData[], listNode);
        for (const n of entityChanged) changed.add(n);

        // Update itemIds from the resolver result
        listState.itemIds = (result as Array<Record<string, unknown>>)
          .map((item) => item.id)
          .filter((id): id is string => typeof id === "string" && id !== "");

        // Store as the initial snapshot for dirty tracking
        listState.initialItemIds = [...listState.itemIds];

        // Sync valuesCache.values[listKey]
        syncListValuesCache(listState);
      } else if (Array.isArray(result) && result.length === 0) {
        // Empty result — clear the list
        listState.itemIds = [];
        listState.initialItemIds = [];
        syncListValuesCache(listState);
      }

      // Auto-dependencies: explicit deps + values tracking + context dependencies
      const mergedDeps = new Set<string>(resolve.deps ?? []);
      for (const p of valuesTracking.getAccessedPaths()) mergedDeps.add(p);
      if (contextTracking) {
        for (const key of contextTracking.getAccessedKeys()) {
          mergedDeps.add(`$context.${key}`);
        }
      }
      state.dependencies = mergedDeps;

      // Update loading = false, status = resolved
      const updatedSt = nodeState.get(listNode);
      nodeState.set(listNode, { ...(updatedSt ?? DEFAULT_LIST_STATE), loading: false });
      state.status = "resolved";
      state.error = null;

      recomputeAndNotify(changed, recompute, notifyChanged);

      // If a dependency changed while pending — re-run immediately
      if (state.pendingRetrigger) {
        state.pendingRetrigger = false;
        state.status = "idle";
        state.promise = null;
        executeListResolve(listNode, resolve, listState, deps);
      }

      return result;
    } catch (err) {
      if (state.status !== "pending") return;

      // ── Error path ──────────────────────────────────────────────────────
      const updatedSt = nodeState.get(listNode);
      nodeState.set(listNode, { ...(updatedSt ?? DEFAULT_LIST_STATE), loading: false });
      state.status = "error";
      state.error = err;

      // Store context dependencies even on the error path
      {
        const mergedDeps = new Set<string>(resolve.deps ?? []);
        if (valuesTracking) {
          for (const p of valuesTracking.getAccessedPaths()) mergedDeps.add(p);
        }
        if (contextTracking) {
          for (const key of contextTracking.getAccessedKeys()) {
            mergedDeps.add(`$context.${key}`);
          }
        }
        state.dependencies = mergedDeps;
      }

      try {
        resolve.onError?.(err, { notify });
      } catch {
        // onError should not throw
      }

      recomputeAndNotify(new Set([listNode, listState as object]), recompute, notifyChanged);

      // If a dependency changed while pending — re-run immediately
      if (state.pendingRetrigger) {
        state.pendingRetrigger = false;
        state.status = "idle";
        state.promise = null;
        executeListResolve(listNode, resolve, listState, deps);
      }

      return undefined;
    }
  })();

  state.promise = promise;
  return promise;
}
