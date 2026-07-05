import { walkFull } from "../traversal";
import type { AnyConfigNode } from "../store/types";
import type { FieldState } from "../compute/index";

/**
 * Collects all leaf nodes of a subtree with their paths and current state.
 * Used for validation on submit.
 */
export function collectLeafStates(
  node: AnyConfigNode,
  nodeState: WeakMap<object, FieldState>,
  parentPath = "",
): Array<{ path: string; state: FieldState }> {
  const result: Array<{ path: string; state: FieldState }> = [];

  walkFull(node, {
    onLeaf(leaf, _key, path) {
      const state = nodeState.get(leaf);
      if (state) result.push({ path, state });
    },
  }, parentPath);

  return result;
}
