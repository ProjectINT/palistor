import { type AnyConfigNode } from "../collectValues";
import type { ResolveState } from "./types";

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
