import type { AnyConfigNode } from "../store/types";
import { CONFIG_PROPS } from "../constants";
import { isLeafNode } from "../traversal";
import { formatValue } from "./formatValue";

/**
 * Format a patch: recursively walks the config tree in parallel with the
 * patch tree and applies the node's formatter (if any) to each leaf value.
 *
 * Returns a new patch object with formatted values.
 * The original patch is not mutated.
 *
 * Used as the first phase before applyPatch:
 *   const formatted = formatPatch(config, patch, allValues);
 *   applyPatch(config, nodeState, formatted);
 */
export function formatPatch(
  configNode: AnyConfigNode,
  patch: Record<string, unknown>,
  allValues: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(patch)) {
    if (CONFIG_PROPS.has(key)) continue;

    const child = configNode[key] as AnyConfigNode | undefined;
    if (!child || typeof child !== "object") continue;

    const patchValue = patch[key];

    if (isLeafNode(child)) {
      // Leaf node — run through the formatter
      result[key] = formatValue(patchValue, child, allValues);
    } else if (patchValue && typeof patchValue === "object" && !Array.isArray(patchValue)) {
      // Group node — recurse
      result[key] = formatPatch(child, patchValue as Record<string, unknown>, allValues);
    }
  }

  return result;
}
