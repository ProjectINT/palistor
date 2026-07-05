import { configKeys, isLeafNode, isListNode } from "../traversal";
import type { AnyConfigNode } from "../store/types";

/**
 * Recursively collects default values from the config.
 *
 * For leaf nodes:
 * - static value → taken as-is
 * - function (computed) → "" as a fallback
 *
 * Stops at nested groups with their own `reset` (reset boundary).
 */
export function collectDefaults(node: AnyConfigNode): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const key of configKeys(node as Record<string, unknown>)) {
    const child = node[key] as AnyConfigNode;
    if (!child || typeof child !== "object") continue;
    if (isListNode(child)) continue; // ListNode — skipped, restored separately

    if (isLeafNode(child)) {
      const raw = child.value;
      result[key] = typeof raw === "function" ? "" : raw;
    } else {
      if (typeof child.reset === "function") continue;
      result[key] = collectDefaults(child);
    }
  }

  return result;
}
