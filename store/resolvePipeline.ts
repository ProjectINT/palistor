/**
 * resolvePipeline — core of the async resolver system.
 *
 * Responsibilities:
 * - Type definitions (Resolve, ResolveState, etc.)
 * - Initialization of resolve states for all nodes with `resolve` in config
 * - Execution of resolve with retry, batching, optimistic updates
 * - Auto-deps tracking via createValuesTrackingProxy
 * - Side-effect buffering and single-flush application
 */

import { CONFIG_PROPS } from "./constants";
import { applyPatch } from "./applyPatch";
import { type AnyConfigNode } from "./collectValues";
import { createValuesTrackingProxy, type PendingWrite } from "./createValuesTrackingProxy";
import type { FieldState } from "./compute";

// ─── Public Types ────────────────────────────────────────────────────────────

/** Notification function registered via useNotifier. User defines the signature. */
export type NotifyFn = (...args: any[]) => void;

/** Error context passed to resolve.onError */
export interface ResolveErrorContext {
  /** Notification function from useNotifier. */
  notify: NotifyFn;
}

/** Async resolver configuration for a group node. */
export interface Resolve<T = Record<string, unknown>> {
  /**
   * Async data loader.
   * `values` is a tracking write-proxy:
   *   - Read: tracks dependencies (auto-deps)
   *   - Write: buffers side-effects (batch)
   * Returns an object with values for THIS node's subtree.
   */
  resolver: (values: any) => Promise<T>;

  /**
   * Synchronous placeholder — set instantly before resolver completes.
   * Structure mirrors resolver return type.
   */
  optimisticResolver?: (values: any) => Partial<T>;

  /**
   * Error handler called after retry exhaustion.
   * `ctx.notify` is the notification function from useNotifier.
   */
  onError: (error: unknown, ctx: ResolveErrorContext) => void;

  /**
   * Explicit dependencies — paths in the values tree.
   * When any of these paths change → re-run resolver.
   * Takes priority for first run (auto-deps not yet collected).
   * After first run: merged with auto-deps.
   */
  deps?: string[];

  options?: {
    /** Wait for first access to the node. Default: true */
    lazy?: boolean;
    /** Throw Promise for React Suspense (loading only). Default: false */
    suspense?: boolean;
    /** Retry options on error */
    retry?: {
      attempts: number;  // default: 0 (no retries)
      delay: number;     // default: 1000 ms
    };
  };
}

// ─── Internal State ──────────────────────────────────────────────────────────

export type ResolveStatus = "idle" | "pending" | "resolved" | "error";

export interface ResolveState {
  status: ResolveStatus;
  /** Current promise (for suspense and deduplication) */
  promise: Promise<unknown> | null;
  /** Last error */
  error: unknown | null;
  /** Paths in values tree that the resolver depends on (auto-deps) */
  dependencies: Set<string>;
  /** Current retry attempt number */
  attempt: number;
}

// ─── Dependencies for resolve execution ──────────────────────────────────────

export interface ResolveDeps {
  rootConfig: AnyConfigNode;
  nodeState: WeakMap<object, FieldState>;
  resolveStates: Map<object, ResolveState>;
  recomputeAll: () => Set<object>;
  notifyChanged: (changed: Set<object>) => void;
  notify: NotifyFn;
  getValues: () => Record<string, unknown>;
}

// ─── Initialization ──────────────────────────────────────────────────────────

/**
 * Recursively finds all nodes with `resolve` in the config tree.
 * Initializes ResolveState for each of them.
 * Returns the list of { node, resolve } entries.
 */
export function initResolveStates(
  rootConfig: AnyConfigNode,
  resolveStates: Map<object, ResolveState>,
): Array<{ node: AnyConfigNode; resolve: Resolve }> {
  const entries: Array<{ node: AnyConfigNode; resolve: Resolve }> = [];

  function walk(node: AnyConfigNode) {
    // Check if this node has a resolve
    if (node.resolve && typeof node.resolve === "object" && typeof (node.resolve as any).resolver === "function") {
      const resolve = node.resolve as unknown as Resolve;
      entries.push({ node, resolve });

      resolveStates.set(node, {
        status: "idle",
        promise: null,
        error: null,
        dependencies: new Set(resolve.deps ?? []),
        attempt: 0,
      });
    }

    // Recurse into children
    for (const key of Object.keys(node)) {
      if (CONFIG_PROPS.has(key)) continue;
      const child = node[key] as AnyConfigNode;
      if (child && typeof child === "object" && !("value" in child)) {
        walk(child);
      }
    }
  }

  walk(rootConfig);
  return entries;
}

// ─── Apply buffered writes ───────────────────────────────────────────────────

/**
 * Resolves a dot-path to the config node and applies value via applyPatch.
 * E.g. path "user.vehicleExists" → navigate to "user" group node → applyPatch { vehicleExists: value }
 */
function applyPendingWrites(
  writes: PendingWrite[],
  rootConfig: AnyConfigNode,
  nodeState: WeakMap<object, FieldState>,
): Set<object> {
  const changed = new Set<object>();

  for (const { path, value } of writes) {
    // Build nested patch from dot-path
    const parts = path.split(".");
    let patch: Record<string, unknown> = {};
    let current = patch;
    for (let i = 0; i < parts.length - 1; i++) {
      current[parts[i]] = {};
      current = current[parts[i]] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]] = value;

    applyPatch(rootConfig, nodeState, patch, changed);
  }

  return changed;
}

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
  const { rootConfig, nodeState, resolveStates, recomputeAll, notifyChanged, notify, getValues } = deps;
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
        applyPatch(node, nodeState, optimisticResult as Record<string, unknown>, allChanged);
      }
    } catch {
      // Optimistic resolver failure is non-fatal — proceed with async resolver
    }
  }

  // Notify about loading: true (and optimistic data)
  const optimisticChanged = recomputeAll();
  for (const n of optimisticChanged) allChanged.add(n);
  notifyChanged(allChanged);

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
          applyPatch(node, nodeState, result as Record<string, unknown>, changed);
        }

        // 2. Flush buffered side-effects
        const writes = tracking.getPendingWrites();
        if (writes.length > 0) {
          const writeChanged = applyPendingWrites(writes, rootConfig, nodeState);
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
        const recomputeChanged = recomputeAll();
        for (const n of recomputeChanged) changed.add(n);
        notifyChanged(changed);

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
    const recomputeChanged = recomputeAll();
    for (const n of recomputeChanged) changed.add(n);
    notifyChanged(changed);

    return undefined;
  })();

  state.promise = promise;
  return promise;
}

// ─── Check if changed paths intersect with resolve dependencies ──────────────

/**
 * Given a set of changed node paths, find all resolve nodes whose dependencies
 * intersect and should be re-triggered.
 *
 * Returns nodes that need re-resolve.
 */
export function findResolvesToRetrigger(
  changedPaths: Set<string>,
  resolveStates: Map<object, ResolveState>,
  resolveEntries: Array<{ node: AnyConfigNode; resolve: Resolve }>,
): Array<{ node: AnyConfigNode; resolve: Resolve }> {
  if (changedPaths.size === 0) return [];

  const toRetrigger: Array<{ node: AnyConfigNode; resolve: Resolve }> = [];

  for (const entry of resolveEntries) {
    const state = resolveStates.get(entry.node);
    if (!state) continue;
    // Only retrigger resolved or error nodes (not idle or pending)
    if (state.status !== "resolved" && state.status !== "error") continue;

    // Check if any dependency matches a changed path
    for (const dep of state.dependencies) {
      if (changedPaths.has(dep)) {
        toRetrigger.push(entry);
        break;
      }
    }
  }

  return toRetrigger;
}

/**
 * Reset a resolve state back to idle (used when dependencies change).
 */
export function resetResolveState(
  node: AnyConfigNode,
  resolveStates: Map<object, ResolveState>,
): void {
  const state = resolveStates.get(node);
  if (!state) return;
  state.status = "idle";
  state.promise = null;
  state.error = null;
  state.attempt = 0;
}
