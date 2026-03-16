import { CONFIG_PROPS } from "../constants";
import type { AnyConfigNode } from "../store/types";
import type { FieldState } from "../compute/index";
import { isDirtyValue } from "./isDirtyValue";

export interface RecomputeDirtyResult {
  anyDirty: boolean;
  changed: Set<object>;
}

/**
 * Recursively recomputes dirty flags for all nodes in the tree.
 *
 * - Leaf nodes: dirty = currentValue differs from initial
 * - Group nodes: dirty = any descendant leaf is dirty
 *
 * Updates nodeState in-place and returns the result with the set of nodes
 * whose dirty state changed.
 */
export function recomputeDirty(
  node: AnyConfigNode,
  nodeState: WeakMap<object, FieldState>,
  initialValueMap: WeakMap<object, unknown>,
): RecomputeDirtyResult {
  let anyDirty = false;
  const changed = new Set<object>();

  for (const key of Object.keys(node)) {
    if (CONFIG_PROPS.has(key)) continue;

    const child = node[key] as AnyConfigNode;
    if (!child || typeof child !== "object") continue;
    if (Array.isArray(child)) continue; // ListNode — пропускаем, обрабатывается в фазе 2

    if ("value" in child) {
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
      const result = recomputeDirty(child, nodeState, initialValueMap);
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
