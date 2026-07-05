import { CONFIG_PROPS } from "../constants";
import { isGroupNode } from "../traversal";
import type { AnyConfigNode } from "./types";

/**
 * Recursively builds the path and parent mappings for all config tree nodes.
 *
 * - `nodePaths`   — WeakMap<node, "user.email"> — absolute path of every node.
 * - `nodeParents` — WeakMap<node, parentNode>  — direct parent.
 *
 * Used by the onChange pipeline (finding ancestors with `onChange`),
 * submit/reset (deriving fieldKey) and other handlers.
 */
export function buildNodeMaps(
  node: AnyConfigNode,
  nodePaths: WeakMap<object, string>,
  nodeParents: WeakMap<object, object>,
  parentPath = "",
): void {
  for (const key of Object.keys(node)) {
    if (CONFIG_PROPS.has(key)) continue;

    const child = node[key] as AnyConfigNode;
    if (!child || typeof child !== "object") continue;
    if (Array.isArray(child)) continue; // ListNode — handled in phase 2

    const path = parentPath ? `${parentPath}.${key}` : key;
    nodePaths.set(child, path);
    nodeParents.set(child, node);

    // Recurse into group nodes (leaves have no children)
    if (isGroupNode(child)) {
      buildNodeMaps(child, nodePaths, nodeParents, path);
    }
  }
}
