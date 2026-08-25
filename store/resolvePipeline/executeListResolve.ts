import type { EntityData } from "../entityRegistry";
import type { ListResolveConfig, ListResolveContext, ListState } from "../store/types";
import {
  buildFilterParams,
  computeServerKey,
  getFilterValues,
} from "../filtering/filterController";
import { recomputeAndNotify } from "../compute/recompute";
import { createContextTrackingProxy } from "./createContextTrackingProxy";
import type { ContextTrackingResult } from "./createContextTrackingProxy";
import { createValuesTrackingProxy } from "./createValuesTrackingProxy";
import { getByPath } from "./getByPath";
import { deepEqual } from "./deepEqual";
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

      // Wrap store.context in a tracking proxy for automatic context dependencies.
      // Capture the context object this attempt runs against: `setContext`
      // replaces `store.context` with a new object, so comparing this snapshot
      // to the live context after the resolver returns detects a mid-flight change.
      const startContext = store.context;
      contextTracking = createContextTrackingProxy(startContext);
      const storeProxy = new Proxy(store, {
        get(target, key) {
          if (key === "context") return contextTracking!.proxy;
          return (target as any)[key];
        },
      });

      // ── Resolver context (filter snapshot / params / request identity) ──
      // ctx is ALWAYS passed (filter.values = {} without a filter block), so a
      // resolver never needs an existence check. The serverKey computed at
      // launch is stamped as issuedKey; a completion whose key no longer
      // matches the live issuedKey is dropped (same family as the
      // status/generation aborts below).
      const fs = listState.filter;
      const launchFilterValues = fs ? getFilterValues(fs, nodeState) : {};
      const launchServerKey = fs ? computeServerKey(fs, nodeState) : "";
      if (fs) {
        fs.serverKey = launchServerKey;
        fs.issuedKey = launchServerKey;
      }
      const ctx: ListResolveContext = {
        filter: {
          values: launchFilterValues,
          params: fs
            ? buildFilterParams(fs, launchFilterValues, (store.context ?? {}) as Record<string, unknown>)
            : undefined,
          key: launchServerKey,
        },
        queryKey: launchServerKey,
      };

      const result = await resolve.resolver(valuesTracking.proxy, storeProxy, ctx);

      // Abort when the status changed while awaiting (e.g. a reset)
      if (state.status !== "pending") return result;
      // Drop a completion whose request identity is no longer the live one.
      if (fs && fs.issuedKey !== launchServerKey) return result;

      // Snapshot values BEFORE applying this resolver's own result, so the
      // in-flight-change check below sees only EXTERNAL mutations during the
      // await — not this resolver's own output (a resolver reading a field it
      // also writes, e.g. via `{...values}`, must not loop).
      const valuesAfterAwait = getValues();

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
      // Server filter paths are declared, not discovered: the resolver reads
      // them via ctx (never via the tracked values proxy), so re-union them
      // after every run or a re-run would lose the dep set.
      if (fs) for (const p of fs.serverPaths) mergedDeps.add(p);
      state.dependencies = mergedDeps;

      // Update loading = false, status = resolved
      const updatedSt = nodeState.get(listNode);
      nodeState.set(listNode, { ...(updatedSt ?? DEFAULT_LIST_STATE), loading: false });
      state.status = "resolved";
      state.error = null;

      recomputeAndNotify(changed, recompute, notifyChanged);

      // A dependency this resolver read may have changed WHILE it was in flight.
      // On the first run its auto-deps aren't known yet, so the notification hook
      // can't mark it and the setContext path (retriggerByPaths) skips pending
      // resolvers — the change would be lost and the resolved list left stale.
      // Compare the start snapshot against the live state for everything the
      // resolver read (values + context) and re-run if anything differs.
      for (const path of valuesTracking.getAccessedPaths()) {
        if (!deepEqual(getByPath(freshValues, path), getByPath(valuesAfterAwait, path))) {
          state.pendingRetrigger = true;
          break;
        }
      }
      if (!state.pendingRetrigger && contextTracking) {
        const currentContext = store.context;
        for (const key of contextTracking.getAccessedKeys()) {
          if (startContext[key] !== currentContext[key]) {
            state.pendingRetrigger = true;
            break;
          }
        }
      }

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
        // Declared server filter paths survive the error path too — a filter
        // change after a failed run must still re-trigger the resolver.
        if (listState.filter) {
          for (const p of listState.filter.serverPaths) mergedDeps.add(p);
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
