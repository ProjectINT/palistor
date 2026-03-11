import { CONFIG_PROPS } from "../constants";
import type { AnyConfigNode } from "../types";
import type { FieldState } from "../compute/index";

/**
 * Captures initial values for all leaf nodes into a WeakMap.
 * Called at store creation and after reset/hydrate.
 */
export function captureInitialValues(
  node: AnyConfigNode,
  nodeState: WeakMap<object, FieldState>,
  initialValueMap: WeakMap<object, unknown>,
): void {
  for (const key of Object.keys(node)) {
    if (CONFIG_PROPS.has(key)) continue;

    const child = node[key] as AnyConfigNode;
    if (!child || typeof child !== "object") continue;

    if ("value" in child) {
      const state = nodeState.get(child);
      if (state) {
        initialValueMap.set(child, state.value);
      }
    } else {
      captureInitialValues(child, nodeState, initialValueMap);
    }
  }
}
