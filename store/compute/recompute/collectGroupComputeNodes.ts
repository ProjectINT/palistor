import type { AnyConfigNode } from "../../store/types";
import { configKeys, isLeafNode } from "../../traversal";
import type { ComputeEntry, GroupComputeMap } from "../../store/registerNodes";

/**
 * Recursively collects all compute entries of a group node's subtree.
 *
 * For each group node, its direct entries from groupComputeMap are taken
 * (leaves + groups with computed props), then child groups are recursed into.
 * Leaf nodes are skipped — they are already in their parent's compute list.
 *
 * ListNodes are skipped entirely. A list's template is a rule set, not a value
 * holder: the values live on entity leaves, and every template rule (label,
 * isVisible, validate, …) is evaluated per entity at proxy read time against
 * that entity's values — nothing reads a template node's nodeState. Recursing
 * into the array (its `__kind` is stamped "group") would pull the template's
 * leaves into the recompute and evaluate their functions against the ROOT
 * values object, where the item's own fields don't exist: a computed
 * `value: (v) => v.first.trim()` in a template crashed the constructor.
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

    if (Array.isArray(child)) continue; // ListNode — its template is not a compute target
    if (isLeafNode(child)) continue; // already in the parent's ownEntries
    result.push(...collectGroupComputeNodes(child, groupComputeMap));
  }

  return result;
}
