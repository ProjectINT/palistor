import { type AnyConfigNode } from "../store/types";

/**
 * Collects all nodes with `onChange` from the node itself up to the root.
 *
 * Order: the node itself first (if it has onChange), then the nearest ancestor, etc.
 */
export function findOnChangeNodes(
  node: object,
  nodeParents: WeakMap<object, object>,
): AnyConfigNode[] {
  const result: AnyConfigNode[] = [];

  // The node itself
  if (typeof (node as AnyConfigNode).onChange === "function") {
    result.push(node as AnyConfigNode);
  }

  // Ancestors
  let current = nodeParents.get(node);
  while (current) {
    if (typeof (current as AnyConfigNode).onChange === "function") {
      result.push(current as AnyConfigNode);
    }
    current = nodeParents.get(current);
  }

  return result;
}
