import type { AnyConfigNode } from "../store/types";
import type { ResolveState } from "../resolvePipeline/index";

/**
 * Lazy trigger + suspense for a group node with resolve.
 *
 * - resolve status "idle" → triggers the resolve.
 * - "pending" with suspense enabled → throws the promise (React Suspense).
 */
export function handleLazyResolve(
  node: AnyConfigNode,
  triggerResolve: ((node: AnyConfigNode) => void) | undefined,
  getResolveState: ((node: AnyConfigNode) => ResolveState | undefined) | undefined,
): void {
  if (!triggerResolve || !getResolveState || !node.resolve) return;

  const resolveState = getResolveState(node);
  if (!resolveState) return;

  if (resolveState.status === "idle") {
    // Defer via queueMicrotask: this is called from the proxy GET trap (i.e. during a
    // React render). Calling triggerResolve synchronously would cause executeResolve to
    // fire notifyChanged → notifyGlobals → useSyncExternalStore listeners still inside
    // the render of another component → "Cannot update a component while rendering".
    queueMicrotask(() => triggerResolve(node));
  }

  if (
    resolveState.status === "pending" &&
    resolveState.promise &&
    (node.resolve as any).options?.suspense === true
  ) {
    throw resolveState.promise;
  }
}
