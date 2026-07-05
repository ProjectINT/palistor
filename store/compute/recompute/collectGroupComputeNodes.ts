import type { AnyConfigNode } from "../../store/types";
import { configKeys, isLeafNode } from "../../traversal";
import type { ComputeEntry, GroupComputeMap } from "../../store/registerNodes";

/**
 * Recursively collects all compute entries of a group node's subtree.
 *
 * For each group node, its direct entries from groupComputeMap are taken
 * (leaves + groups with computed props), then child groups are recursed into.
 * Leaf nodes are skipped — they are already in their parent's compute list.
 */
export function collectGroupComputeNodes(
  groupNode: AnyConfigNode,
  groupComputeMap: GroupComputeMap,
): ComputeEntry[] {
  const result: ComputeEntry[] = [];

  // Direct entries of this group (leaves + groups with computed props)
  const ownEntries = groupComputeMap.get(groupNode);
  if (ownEntries) result.push(...ownEntries);

  // Recurse into child groups
  for (const key of configKeys(groupNode as Record<string, unknown>)) {
    const child = groupNode[key] as AnyConfigNode;

    if (!child || typeof child !== "object") continue;

    if (isLeafNode(child)) continue; // already in the parent's ownEntries
    result.push(...collectGroupComputeNodes(child, groupComputeMap));
  }

  return result;
}
