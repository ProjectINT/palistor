import { isGroupNode } from "../traversal";

/**
 * Determine the path of the group a node belongs to.
 *
 * - Leaf node (has "value") → the parent group's path
 * - Group node → its own path
 * - Root → ""
 */
export function getNodeGroupPath(
  node: object,
  nodeParents: WeakMap<object, object>,
  nodePaths: WeakMap<object, string>,
): string {
  // Group node → its own path
  if (isGroupNode(node)) {
    return nodePaths.get(node) ?? "";
  }
  // Leaf → the parent group's path
  const parent = nodeParents.get(node);
  if (!parent) return "";
  return nodePaths.get(parent) ?? "";
}
