import { type AnyConfigNode } from "../collectValues";
import type { ResolveState } from "./types";

/**
 * Reset a resolve state back to idle (used when dependencies change).
 * If `dependencies` is provided and the state doesn't exist yet, it is created (used during init).
 */
export function resetResolveState(
  node: AnyConfigNode,
  resolveStates: Map<object, ResolveState>,
  dependencies?: Set<string>,
): void {
  const state = resolveStates.get(node);
  if (!state) {
    if (dependencies === undefined) return;
    resolveStates.set(node, { status: "idle", promise: null, error: null, dependencies, attempt: 0 });
    return;
  }
  state.status = "idle";
  state.promise = null;
  state.error = null;
  state.attempt = 0;
}
