import { walkFull } from "../traversal";
import type { AnyConfigNode } from "../store/types";
import type { FieldState } from "../compute/index";

/**
 * Собирает все листовые узлы поддерева с их путями и текущим состоянием.
 * Используется для валидации при submit.
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
