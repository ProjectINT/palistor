import { walkFull } from "../traversal";
import type { AnyConfigNode } from "../store/types";
import type { FieldState } from "../compute/index";

/**
 * Sets the `revalidate` flag on a group node and recursively propagates it
 * to ALL child nodes — leaf fields as well as nested groups.
 *
 * @param node       — config node (group or field)
 * @param revalidate — the flag value to set
 * @param nodeState  — WeakMap with each node's current state (FieldState)
 * @returns          — set of nodes whose revalidate flag actually changed
 */
export function setGroupRevalidate(
  node: AnyConfigNode,
  revalidate: boolean,
  nodeState: WeakMap<object, FieldState>,
): Set<object> {
  const changed = new Set<object>();

  // Update the root node itself (walkFull doesn't visit it).
  updateRevalidate(node, revalidate, nodeState, changed);

  walkFull(node, {
    onLeaf(leafNode) {
      updateRevalidate(leafNode, revalidate, nodeState, changed);
    },
    onGroupEnter(groupNode) {
      updateRevalidate(groupNode, revalidate, nodeState, changed);
    },
  });

  return changed;
}

function updateRevalidate(
  node: object,
  revalidate: boolean,
  nodeState: WeakMap<object, FieldState>,
  changed: Set<object>,
) {
  const state = nodeState.get(node);
  if (state && state.revalidate !== revalidate) {
    nodeState.set(node, { ...state, revalidate });
    changed.add(node);
  }
}
