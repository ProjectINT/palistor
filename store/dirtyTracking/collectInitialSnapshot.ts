import { CONFIG_PROPS } from "../constants";
import type { AnyConfigNode } from "../types";

/**
 * Collects current initial values from the initialValueMap for a subtree.
 * Used by reset to restore fields to their initial state.
 *
 * Stops at reset boundaries (child groups with their own `reset` function).
 * Falls back to config default if a leaf has no entry in initialValueMap.
 */
export function collectInitialSnapshot(
  node: AnyConfigNode,
  initialValueMap: WeakMap<object, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(node)) {
    if (CONFIG_PROPS.has(key)) continue;

    const child = node[key] as AnyConfigNode;
    if (!child || typeof child !== "object") continue;

    if ("value" in child) {
      const initial = initialValueMap.get(child);
      if (initial !== undefined) {
        result[key] = initial;
      } else {
        const raw = child.value;
        result[key] = typeof raw === "function" ? "" : raw;
      }
    } else {
      if (typeof child.reset === "function") continue;
      result[key] = collectInitialSnapshot(child, initialValueMap);
    }
  }

  return result;
}
