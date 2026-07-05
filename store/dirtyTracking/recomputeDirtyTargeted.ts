import { configKeys, isLeafNode, isListNode } from "../traversal";
import { resolveGroupByPath } from "../groupDeps/resolveGroupByPath";
import { getNodeGroupPath } from "../groupDeps/getNodeGroupPath";
import type { AnyConfigNode } from "../store/types";
import type { FieldState } from "../compute/index";
import { isDirtyValue } from "./isDirtyValue";

export interface RecomputeDirtyResult {
  anyDirty: boolean;
  changed: Set<object>;
}

/** Check whether two string arrays have identical contents in the same order. */
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Scoped dirty recompute: recomputes dirty only for the groups containing
 * changed nodes, bubbling up to the ancestors.
 *
 * Complexity: O(affectedGroups × childrenPerGroup) instead of O(allNodes).
 */
export function recomputeDirtyTargeted(
  changedNodes: Set<object>,
  rootConfig: AnyConfigNode,
  nodeState: WeakMap<object, FieldState>,
  initialValueMap: WeakMap<object, unknown>,
  nodeParents: WeakMap<object, object>,
  nodePaths: WeakMap<object, string>,
  listStates?: WeakMap<object, { itemIds: string[]; initialItemIds: string[] }>,
): RecomputeDirtyResult {
  const changed = new Set<object>();

  // 1. Recompute dirty only for the LEAVES from changedNodes
  const affectedGroupPaths = new Set<string>();
  for (const node of changedNodes) {
    if (isLeafNode(node)) {
      const state = nodeState.get(node);
      if (state) {
        const initial = initialValueMap.get(node);
        const dirty = isDirtyValue(state.value, initial);
        if (state.dirty !== dirty) {
          nodeState.set(node, { ...state, dirty });
          changed.add(node);
        }
      }
    }
    affectedGroupPaths.add(getNodeGroupPath(node, nodeParents, nodePaths));
  }

  // 2. For every affected group — aggregate dirty from its immediate children
  //    and bubble up to the ancestors
  const processed = new Set<string>();
  const queue = [...affectedGroupPaths];

  while (queue.length > 0) {
    const groupPath = queue.shift()!;
    if (processed.has(groupPath)) continue;
    processed.add(groupPath);

    const groupNode = resolveGroupByPath(rootConfig, groupPath);
    if (!groupNode) continue; // entity paths — skip

    // Aggregate dirty from immediate children
    let anyChildDirty = false;
    for (const key of configKeys(groupNode as Record<string, unknown>)) {
      const child = groupNode[key] as AnyConfigNode;
      if (!child || typeof child !== "object") continue;

      if (isListNode(child)) {
        if (listStates) {
          const ls = listStates.get(child);
          if (ls && !arraysEqual(ls.itemIds, ls.initialItemIds)) {
            anyChildDirty = true;
          }
        }
        continue;
      }

      const childState = nodeState.get(child);
      if (childState?.dirty) anyChildDirty = true;
    }

    // Update dirty on the group node itself
    const groupState = nodeState.get(groupNode);
    if (groupState && groupState.dirty !== anyChildDirty) {
      nodeState.set(groupNode, { ...groupState, dirty: anyChildDirty });
      changed.add(groupNode);

      // Bubble up: enqueue the parent group
      const parent = nodeParents.get(groupNode);
      if (parent) {
        const parentPath = nodePaths.get(parent) ?? "";
        if (!processed.has(parentPath)) {
          queue.push(parentPath);
        }
      }
    }
  }

  // 3. Determine anyDirty from the root
  const rootState = nodeState.get(rootConfig);
  const anyDirty = rootState?.dirty ?? false;

  return { anyDirty, changed };
}
