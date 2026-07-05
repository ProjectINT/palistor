import { CONFIG_PROPS } from "../constants";
import { isLeafNode, isListNode } from "../traversal";
import type { AnyConfigNode } from "../store/types";
import type { FieldState } from "../compute/index";
import { updateValuesCacheEntry, type ValuesCache } from "../valuesCache/valuesCache";

/**
 * Apply a patch (setter result) to nodeState.
 *
 * Recursively walks the config tree in parallel with the patch tree.
 * For every patch key:
 *   - Leaf node (has "value") → updates the value in nodeState,
 *     if it actually changed (strict !==).
 *   - Group node → recurses deeper.
 *
 * Returns the Set of nodes whose values actually changed,
 * so the caller knows exactly who to notify.
 */
export function applyPatch(
  configNode: AnyConfigNode,
  nodeState: WeakMap<object, FieldState>,
  patch: Record<string, unknown>,
  changed: Set<object>,
  valuesCache?: ValuesCache,
): Set<object> {
  for (const key of Object.keys(patch)) {
    // Skip service config keys (value, label, validate, …)
    if (CONFIG_PROPS.has(key)) continue;

    const child = configNode[key] as AnyConfigNode | undefined;

    if (!child || typeof child !== "object") continue;
    if (isListNode(child)) continue; // ListNode — skipped, updated via store.set()

    const patchValue = patch[key];

    if (isLeafNode(child)) {
      // Leaf node — update the value only when it actually changed
      const state = nodeState.get(child);

      if (state && state.value !== patchValue) {
        nodeState.set(child, { ...state, value: patchValue });
        if (valuesCache) updateValuesCacheEntry(valuesCache, child, patchValue);
        changed.add(child);
      }
    } else if (patchValue && typeof patchValue === "object" && !Array.isArray(patchValue)) {
      // Group node — recurse
      applyPatch(child, nodeState, patchValue as Record<string, unknown>, changed, valuesCache);
    }
  }

  return changed;
}
