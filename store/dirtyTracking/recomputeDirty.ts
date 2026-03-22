import { configKeys, isLeaf, isListNode } from "../traversal";
import type { AnyConfigNode } from "../store/types";
import type { FieldState } from "../compute/index";
import { isDirtyValue } from "./isDirtyValue";

/** Check whether two string arrays have identical contents in the same order. */
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export interface RecomputeDirtyResult {
  anyDirty: boolean;
  changed: Set<object>;
}

/**
 * Recursively recomputes dirty flags for all nodes in the tree.
 *
 * - Leaf nodes: dirty = currentValue differs from initial
 * - Group nodes: dirty = any descendant leaf is dirty
 * - List nodes: dirty = itemIds !== initialItemIds (by composition)
 *
 * Updates nodeState in-place and returns the result with the set of nodes
 * whose dirty state changed.
 */
export function recomputeDirty(
  node: AnyConfigNode,
  nodeState: WeakMap<object, FieldState>,
  initialValueMap: WeakMap<object, unknown>,
  listStates?: WeakMap<object, { itemIds: string[]; initialItemIds: string[] }>,
): RecomputeDirtyResult {
  let anyDirty = false;
  const changed = new Set<object>();

  for (const key of configKeys(node as Record<string, unknown>)) {

    const child = node[key] as AnyConfigNode;
    if (!child || typeof child !== "object") continue;

    if (isListNode(child)) {
      // ListNode — dirty по составу itemIds
      if (listStates) {
        const ls = listStates.get(child);
        if (ls && !arraysEqual(ls.itemIds, ls.initialItemIds)) {
          anyDirty = true;
        }
      }
      continue;
    }

    if (isLeaf(child as object)) {
      const state = nodeState.get(child);
      if (state) {
        const initial = initialValueMap.get(child);
        const dirty = isDirtyValue(state.value, initial);
        if (state.dirty !== dirty) {
          nodeState.set(child, { ...state, dirty });
          changed.add(child);
        }
        if (dirty) anyDirty = true;
      }
    } else {
      const result = recomputeDirty(child, nodeState, initialValueMap, listStates);
      for (const n of result.changed) changed.add(n);

      const state = nodeState.get(child);
      if (state && state.dirty !== result.anyDirty) {
        nodeState.set(child, { ...state, dirty: result.anyDirty });
        changed.add(child);
      }
      if (result.anyDirty) anyDirty = true;
    }
  }

  return { anyDirty, changed };
}
