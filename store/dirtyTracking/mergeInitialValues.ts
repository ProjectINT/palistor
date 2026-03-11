import { CONFIG_PROPS } from "../constants";
import type { AnyConfigNode } from "../types";
import type { FieldState } from "../compute";

/**
 * Incrementally merges initial values from a patch into the initialValueMap.
 * Only updates leaf nodes whose keys are present in the patch.
 *
 * Called after resolver success to make resolver data part of the initial state.
 * Optimistic resolver does NOT call this — only the real resolver result counts.
 */
export function mergeInitialValues(
  node: AnyConfigNode,
  nodeState: WeakMap<object, FieldState>,
  initialValueMap: WeakMap<object, unknown>,
  patch: Record<string, unknown>,
): void {
  for (const key of Object.keys(patch)) {
    if (CONFIG_PROPS.has(key)) continue;

    const child = node[key] as AnyConfigNode;
    if (!child || typeof child !== "object") continue;

    const patchValue = patch[key];

    if ("value" in child) {
      const state = nodeState.get(child);
      if (state) {
        initialValueMap.set(child, state.value);
      }
    } else if (patchValue && typeof patchValue === "object" && !Array.isArray(patchValue)) {
      mergeInitialValues(child, nodeState, initialValueMap, patchValue as Record<string, unknown>);
    }
  }
}
