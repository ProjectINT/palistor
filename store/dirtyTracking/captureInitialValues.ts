import { walkFull } from "../traversal";
import type { AnyConfigNode } from "../store/types";
import type { FieldState } from "../compute/index";

/**
 * Captures initial values for all leaf nodes into a WeakMap.
 * Called at store creation and after reset/hydrate.
 */
export function captureInitialValues(
  node: AnyConfigNode,
  nodeState: WeakMap<object, FieldState>,
  initialValueMap: WeakMap<object, unknown>,
): void {
  walkFull(node, {
    onLeaf(leaf) {
      const state = nodeState.get(leaf);
      if (state) {
        initialValueMap.set(leaf, state.value);
      }
    },
  });
}
