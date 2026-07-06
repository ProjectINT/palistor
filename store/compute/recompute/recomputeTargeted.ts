import {
  getNodeGroupPath,
  getRecipientGroups,
  resolveGroupByPath,
} from "../../groupDeps/groupDeps";
import type { RecomputeTargetedDeps } from "./types";
import { recomputeLeaves } from "./recomputeLeaves";

// ─── Targeted recompute ──────────────────────────────────────────────────────

/**
 * Targeted recompute: instead of recomputing ALL groups,
 * recomputes only the affected groups + their recipients.
 *
 * Algorithm:
 * 1. Determine the groups of the changed nodes (source groups).
 * 2. BFS over the dependency map: collect all recipient groups in topological order.
 * 3. For each affected group, recompute only its OWN leaves (non-recursively).
 *
 * @param changedNodes — nodes whose values changed (the written node + setter targets)
 */
export function recomputeTargeted(
  changedNodes: Set<object>,
  deps: RecomputeTargetedDeps,
): Set<object> {

  const {
    rootConfig, groupComputeMap,
    nodeState, nodeParents, nodePaths,
    groupDeps, valuesCache, translate, trackingWrap,
  } = deps;

  // 1. Find the source groups of the changes
  const sourceGroups = new Set<string>();
  for (const node of changedNodes) {
    sourceGroups.add(getNodeGroupPath(node, nodeParents, nodePaths));
  }

  // 2. BFS — collect all affected groups in "donors first, then recipients" order
  const orderedGroups: string[] = [...sourceGroups];
  const visited = new Set(sourceGroups);

  let i = 0;
  while (i < orderedGroups.length) {
    const current = orderedGroups[i++];
    const recipients = getRecipientGroups(groupDeps, current);

    for (const r of recipients) {
      if (!visited.has(r)) {
        visited.add(r);
        orderedGroups.push(r);
      }
    }
  }

  // 3. Recompute each group (only its OWN leaves, non-recursively)
  const allChanged = new Set<object>();

  for (const groupPath of orderedGroups) {
    const groupNode = resolveGroupByPath(rootConfig, groupPath);
    // Entity groups ("_entity_.*" paths) don't exist in rootConfig — skip
    if (!groupNode) continue;
    const ownEntries = groupComputeMap.get(groupNode) ?? [];
    const changed = recomputeLeaves(ownEntries, nodeState, valuesCache, translate, trackingWrap);
    for (const n of changed) allChanged.add(n);
  }

  return allChanged;
}
