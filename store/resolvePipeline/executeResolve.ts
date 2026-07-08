import { applyPatch } from "../applyPatch/applyPatch";
import { type AnyConfigNode } from "../store/types";
import { createValuesTrackingProxy } from "./createValuesTrackingProxy";
import { createContextTrackingProxy } from "./createContextTrackingProxy";
import type { ContextTrackingResult } from "./createContextTrackingProxy";
import { mergeInitialValues } from "../dirtyTracking";
import { recomputeAndNotify } from "../compute/recompute";
import type { Resolve, ResolveDeps } from "./types";
import { applyPendingWrites } from "./applyPendingWrites";
import { getByPath } from "./getByPath";
import { deepEqual } from "./deepEqual";

// ─── Core execution ──────────────────────────────────────────────────────────

/**
 * Run resolve for a given node.
 *
 * Pipeline:
 * 1. Check status → if pending, return the existing promise (deduplication)
 * 2. Set status = pending, loading = true
 * 3. If there's an optimisticResolver → run it, apply the patch (no notify, batched)
 * 4. Wrap values in a tracking write-proxy
 * 5. Call resolver(trackedValues)
 * 6. Retry logic: on error retry up to retry.attempts times
 * 7. On success:
 *    - applyPatch(result) to the node's subtree
 *    - flush buffered writes (side effects)
 *    - loading = false, status = resolved
 *    - recomputeAll (once)
 *    - notifyChanged (once)
 * 8. On error (after all retries):
 *    - onError(error, { notify })
 *    - loading = false, status = error
 *    - recomputeAll + notifyChanged
 * 9. Store accessedPaths for auto-dependencies
 */
export function executeResolve(
  node: AnyConfigNode,
  resolve: Resolve,
  deps: ResolveDeps,
): Promise<unknown> {
  const {
    rootConfig, nodeState,
    resolveStates, recompute,
    notifyChanged, notify,
    getValues, initialValueMap,
    valuesCache, store
  } = deps;

  const state = resolveStates.get(node);

  if (!state) return Promise.resolve();

  // Deduplication: if already pending, return the same promise
  if (state.status === "pending" && state.promise) {
    return state.promise;
  }

  // ── Set loading state ──────────────────────────────────────────────────────
  state.status = "pending";
  state.attempt = 0;
  state.error = null;

  // Update loading in FieldState
  const nodeSt = nodeState.get(node);
  if (nodeSt) {
    nodeState.set(node, { ...nodeSt, loading: true });
  } else {
    nodeState.set(node, {
      value: undefined,
      isVisible: true,
      isRequired: false,
      isDisabled: false,
      isReadOnly: false,
      loading: true,
    });
  }

  // ── Optimistic resolver (synchronous) ──────────────────────────────────────
  const allChanged = new Set<object>();
  allChanged.add(node); // the node itself changed (loading: true)

  if (resolve.optimisticResolver) {
    try {
      const values = getValues();
      const optimisticResult = resolve.optimisticResolver(values);
      if (optimisticResult && typeof optimisticResult === "object") {
        applyPatch(node, nodeState, optimisticResult as Record<string, unknown>, allChanged, valuesCache);
      }
    } catch (error) {
      // An optimistic resolver error is non-critical — continue with the async resolver
      console.warn('Error in optimistic resolver:', error);
    }
  }

  // Notify about loading: true (and any optimistic data)
  recomputeAndNotify(allChanged, recompute, notifyChanged);

  // ── Async resolver execution ─────────────────────────────────────────────
  const retryOpts = resolve.options?.retry ?? { attempts: 0, delay: 1000 };
  const maxAttempts = retryOpts.attempts;
  const retryDelay = retryOpts.delay ?? 1000;

  const promise = (async (): Promise<unknown> => {
    let lastError: unknown;
    // Tracks context keys accessed in the last attempt (for saving deps on error path)
    let contextTracking: ContextTrackingResult | null = null;

    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      state.attempt = attempt;

      // Wait before retrying (except the first attempt)
      if (attempt > 0) {
        await new Promise<void>((r) => setTimeout(r, retryDelay));
        // Re-check: if the status changed meanwhile (e.g. a reset happened) — abort
        if (state.status !== "pending") return;
      }

      try {
        // Create a tracking proxy over a fresh values snapshot
        const freshValues = getValues();
        const tracking = createValuesTrackingProxy(freshValues);

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

        const result = await resolve.resolver(tracking.proxy, storeProxy);

        // Re-check: if the status changed while awaiting — abort
        if (state.status !== "pending") return result;

        // Snapshot values BEFORE applying this resolver's own result, so the
        // in-flight-change check below sees only EXTERNAL mutations (writes /
        // other resolves) that happened during the await — not this resolver's
        // own output (a resolver reading a field it also writes must not loop).
        const valuesAfterAwait = getValues();

        // ── Success path ─────────────────────────────────────────────────
        const changed = new Set<object>();
        changed.add(node);

        // 1. Apply the resolver result to the node's subtree
        if (result && typeof result === "object") {
          applyPatch(node, nodeState, result as Record<string, unknown>, changed, valuesCache);
          // Update the initial snapshot for the affected leaves (resolver data = initial state)
          mergeInitialValues(node, nodeState, initialValueMap, result as Record<string, unknown>);
        }

        // 2. Flush buffered side effects
        const writes = tracking.getPendingWrites();

        if (writes.length > 0) {
          const writeChanged = applyPendingWrites(writes, rootConfig, nodeState, valuesCache);
          for (const n of writeChanged) changed.add(n);
        }

        // 3. Update loading / status
        const updatedState = nodeState.get(node);
        if (updatedState) {
          nodeState.set(node, { ...updatedState, loading: false });
        }
        state.status = "resolved";
        state.error = null;

        // 4. Store auto-dependencies (merged with explicit deps)
        const accessedPaths = tracking.getAccessedPaths();
        const mergedDeps = new Set<string>(resolve.deps ?? []);
        for (const p of accessedPaths) mergedDeps.add(p);
        // Add context dependencies with the $context. prefix
        for (const key of contextTracking!.getAccessedKeys()) {
          mergedDeps.add(`$context.${key}`);
        }
        state.dependencies = mergedDeps;

        // A dependency this resolver read may have changed WHILE it was in
        // flight. On the first run its auto-deps aren't known yet, so the
        // notification hook can't mark it (empty state.dependencies) and the
        // setContext path (retriggerByPaths) skips pending resolvers outright —
        // the change would be lost and the resolved data left stale. Compare the
        // start snapshot against the live state for everything the resolver read
        // (values + context) and re-run if anything differs.
        for (const path of accessedPaths) {
          if (!deepEqual(getByPath(freshValues, path), getByPath(valuesAfterAwait, path))) {
            state.pendingRetrigger = true;
            break;
          }
        }
        if (!state.pendingRetrigger) {
          const currentContext = store.context;
          for (const key of contextTracking!.getAccessedKeys()) {
            if (startContext[key] !== currentContext[key]) {
              state.pendingRetrigger = true;
              break;
            }
          }
        }

        // 5. Recompute + notify (once)
        recomputeAndNotify(changed, recompute, notifyChanged);

        // 6. If a dependency changed while pending — re-run immediately
        if (state.pendingRetrigger) {
          state.pendingRetrigger = false;
          state.status = "idle";
          state.promise = null;
          executeResolve(node, resolve, deps);
        }

        return result;
      } catch (err) {
        lastError = err;
        // Move on to the next attempt (if any)
      }
    }

    // ── Error path (all attempts exhausted) ──────────────────────────────────
    if (state.status !== "pending") return; // aborted

    const changed = new Set<object>();

    changed.add(node);

    // Update loading / status / error
    const updatedState = nodeState.get(node);
    if (updatedState) {
      nodeState.set(node, { ...updatedState, loading: false });
    }
    state.status = "error";
    state.error = lastError;

    // Store context dependencies even on the error path
    // (so setContext can re-trigger resolvers in the "error" status)
    if (contextTracking && contextTracking.getAccessedKeys().size > 0) {
      const mergedDeps = new Set<string>(resolve.deps ?? []);
      for (const key of contextTracking.getAccessedKeys()) {
        mergedDeps.add(`$context.${key}`);
      }
      state.dependencies = mergedDeps;
    }

    // Invoke the onError handler
    try {
      resolve.onError(lastError, { notify });
    } catch {
      // onError should not throw, but if it does — swallow
    }

    // Recompute + notify
    recomputeAndNotify(changed, recompute, notifyChanged);

    // If a dependency changed while pending — re-run immediately
    if (state.pendingRetrigger) {
      state.pendingRetrigger = false;
      state.status = "idle";
      state.promise = null;
      executeResolve(node, resolve, deps);
    }

    return undefined;
  })();

  state.promise = promise;
  return promise;
}
