import { isLeafNode, isGroupNode } from "../../traversal/nodeClassifier";
export { isLeafNode, isGroupNode } from "../../traversal/nodeClassifier";
/**
 * Whether the node is a list (array of length 1-2).
 * array[0] — template (a regular group), array[1] — optional listConfig.
 *
 * NOTE: Stricter check than traversal.isListNode (length 1-2).
 * Used when building proxies and expanding keys.
 */
export function isListNode(node: unknown): node is readonly [object, ...unknown[]] {
  return Array.isArray(node) && node.length >= 1 && node.length <= 2;
}

/** Utility class for node type checks. Constructed without arguments. */
export class NodeUtils {
  isLeafNode = isLeafNode;
  isGroupNode = isGroupNode;
  isListNode = isListNode;
}
