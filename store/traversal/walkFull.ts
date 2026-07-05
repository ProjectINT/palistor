import { configKeys, isLeafNode, isListNode } from "./nodeClassifier";
import type { AnyConfigNode } from "../store/types";

export interface TreeVisitor {
  /**
   * Called for every leaf node ({ value: ... }).
   * @param node — config node (object ref, usable as a WeakMap key)
   * @param key — key name in the parent (e.g. "city")
   * @param path — full dot-path (e.g. "address.city")
   * @param parent — parent config node
   */
  onLeaf(node: object, key: string, path: string, parent: AnyConfigNode): void;

  /**
   * Called for a group node BEFORE recursing into it.
   * Return false to skip the subtree (e.g. a reset boundary).
   * When undefined — always enters.
   */
  onGroupEnter?(node: AnyConfigNode, key: string, path: string, parent: AnyConfigNode): boolean | void;

  /**
   * Called for a group node AFTER all its descendants have been visited.
   * Optional — for aggregation (e.g. dirty = any child dirty).
   */
  onGroupExit?(node: AnyConfigNode, key: string, path: string, parent: AnyConfigNode): void;

  /**
   * Called for a list node (Array).
   * When undefined — lists are skipped.
   */
  onList?(node: unknown[], key: string, path: string, parent: AnyConfigNode): void;
}

/**
 * Full config tree walk with visitor callbacks.
 * Replaces the repeating Object.keys + CONFIG_PROPS + leaf/group/list pattern.
 */
export function walkFull(
  node: AnyConfigNode,
  visitor: TreeVisitor,
  parentPath = "",
): void {
  for (const key of configKeys(node as Record<string, unknown>)) {
    const child = node[key];
    if (!child || typeof child !== "object") continue;

    const path = parentPath ? `${parentPath}.${key}` : key;

    if (isListNode(child)) {
      visitor.onList?.(child as unknown[], key, path, node);
      continue;
    }

    if (isLeafNode(child as object)) {
      visitor.onLeaf(child as object, key, path, node);
    } else {
      const enter = visitor.onGroupEnter?.(child as AnyConfigNode, key, path, node);
      if (enter === false) continue;
      walkFull(child as AnyConfigNode, visitor, path);
      visitor.onGroupExit?.(child as AnyConfigNode, key, path, node);
    }
  }
}
