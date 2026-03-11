import { applyPatch } from "../applyPatch/applyPatch";
import { type AnyConfigNode } from "../types";
import { createValuesTrackingProxy } from "./createValuesTrackingProxy";
import { mergeInitialValues } from "../dirtyTracking";
import { recomputeAndNotify } from "../compute/recompute";
import type { Resolve, ResolveDeps } from "./types";
import { applyPendingWrites } from "./applyPendingWrites";

// ─── Core execution ──────────────────────────────────────────────────────────

/**
 * Execute a resolve for a given node.
 *
 * Pipeline:
 * 1. Check status → if pending, return existing promise (deduplication)
 * 2. Set status = pending, loading = true
 * 3. If optimisticResolver exists → run, apply patch (without notify, batch)
 * 4. Wrap values in tracking write-proxy
 * 5. Call resolver(trackedValues)
 * 6. Retry logic: on error, retry up to retry.attempts times
 * 7. On success:
 *    - applyPatch(result) to node's subtree
 *    - flush buffered writes (side-effects)
 *    - loading = false, status = resolved
 *    - recomputeAll (once)
 *    - notifyChanged (once)
 * 8. On error (after all retries):
 *    - onError(error, { notify })
 *    - loading = false, status = error
 *    - recomputeAll + notifyChanged
 * 9. Save accessedPaths for auto-deps
 */
export function executeResolve(
  node: AnyConfigNode,
  resolve: Resolve,
  deps: ResolveDeps,
): Promise<unknown> {
  const { rootConfig, nodeState, resolveStates, recomputeAll, notifyChanged, notify, getValues, initialValueMap, valuesCache } = deps;
  const state = resolveStates.get(node);
  if (!state) return Promise.resolve();

  // Deduplication: if already pending, return the same promise
  if (state.status === "pending" && state.promise) {
    return state.promise;
  }

  // ── Set loading state ────────────────────────────────────────────────────
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

  // ── Optimistic resolver (sync) ───────────────────────────────────────────
  const allChanged = new Set<object>();
  allChanged.add(node); // node itself changed (loading: true)

  if (resolve.optimisticResolver) {
    try {
      const values = getValues();
      const optimisticResult = resolve.optimisticResolver(values);
      if (optimisticResult && typeof optimisticResult === "object") {
        applyPatch(node, nodeState, optimisticResult as Record<string, unknown>, allChanged, valuesCache);
      }
    } catch {
      // Optimistic resolver failure is non-fatal — proceed with async resolver
    }
  }

  // Notify about loading: true (and optimistic data)
  recomputeAndNotify(allChanged, recomputeAll, notifyChanged);

  // ── Async resolver execution ─────────────────────────────────────────────
  const retryOpts = resolve.options?.retry ?? { attempts: 0, delay: 1000 };
  const maxAttempts = retryOpts.attempts;
  const retryDelay = retryOpts.delay ?? 1000;

  const promise = (async (): Promise<unknown> => {
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      state.attempt = attempt;

      // Wait before retry (not on first attempt)
      if (attempt > 0) {
        await new Promise<void>((r) => setTimeout(r, retryDelay));
        // Re-check: if status changed (e.g. reset happened), abort
        if (state.status !== "pending") return;
      }

      try {
        // Create tracking proxy for fresh values snapshot
        const freshValues = getValues();
        const tracking = createValuesTrackingProxy(freshValues);

        const result = await resolve.resolver(tracking.proxy);

        // Re-check: if status changed during await, abort
        if (state.status !== "pending") return result;

        // ── Success path ─────────────────────────────────────────────────
        const changed = new Set<object>();
        changed.add(node);

        // 1. Apply resolver result to node's subtree
        if (result && typeof result === "object") {
          applyPatch(node, nodeState, result as Record<string, unknown>, changed, valuesCache);
          // Update initial snapshot for affected leaves (resolver data = initial state)
          mergeInitialValues(node, nodeState, initialValueMap, result as Record<string, unknown>);
        }

        // 2. Flush buffered side-effects
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

        // 4. Save auto-deps (merge with explicit deps)
        const accessedPaths = tracking.getAccessedPaths();
        const mergedDeps = new Set<string>(resolve.deps ?? []);
        for (const p of accessedPaths) mergedDeps.add(p);
        state.dependencies = mergedDeps;

        // 5. Recompute + notify (once)
        recomputeAndNotify(changed, recomputeAll, notifyChanged);

        return result;
      } catch (err) {
        lastError = err;
        // Continue to next retry attempt (if available)
      }
    }

    // ── Error path (all retries exhausted) ────────────────────────────────
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

    // Call onError handler
    try {
      resolve.onError(lastError, { notify });
    } catch {
      // onError should not throw, but if it does — swallow
    }

    // Recompute + notify
    recomputeAndNotify(changed, recomputeAll, notifyChanged);

    return undefined;
  })();

  state.promise = promise;
  return promise;
}
