import type { AnyConfigNode } from "../store/types";
import type { FieldState } from "../compute/index";
import { updateValuesCacheEntry, type ValuesCache } from "../valuesCache/valuesCache";

/**
 * Phase 2: store the value in nodeState.
 *
 * Updates FieldState immutably: creates a new object with the new value.
 * Returns true when stored, false when the node is not registered.
 */
export function storeValue(
  node: AnyConfigNode,
  processedValue: unknown,
  nodeState: WeakMap<object, FieldState>,
  valuesCache?: ValuesCache,
): boolean {
  const state = nodeState.get(node);
  if (!state) return false;

  nodeState.set(node, { ...state, value: processedValue });
  if (valuesCache) updateValuesCacheEntry(valuesCache, node, processedValue);
  return true;
}
