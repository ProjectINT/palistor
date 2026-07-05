import { type AnyConfigNode } from "../store/types";
import { configKeys, isLeafNode } from "../traversal";
import { pairKey } from "./pairKey";

/**
 * Create the dependency map with a self-dependency for every group.
 *
 * A group is any config node without "value".
 * The root group is denoted by the empty string "".
 */
export function createGroupDeps(
  rootConfig: AnyConfigNode,
  nodePaths: WeakMap<object, string>,
): Set<string> {
  const deps = new Set<string>();

  // Root self-dependency
  deps.add(pairKey("", ""));

  // Self-dependencies of nested groups
  function walk(node: AnyConfigNode): void {
    for (const key of configKeys(node as Record<string, unknown>)) {
      const child = node[key] as AnyConfigNode;
      if (!child || typeof child !== "object") continue;
      if (isLeafNode(child)) continue; // a leaf is not a group
      const path = nodePaths.get(child) ?? "";
      deps.add(pairKey(path, path));
      walk(child);
    }
  }

  walk(rootConfig);
  return deps;
}
