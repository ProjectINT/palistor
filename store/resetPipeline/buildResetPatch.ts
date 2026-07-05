import type { AnyConfigNode } from "../store/types";
import { collectDefaults } from "./collectDefaults";
import { collectInitialSnapshot } from "../dirtyTracking";

/**
 * Builds the patch for a group reset.
 *
 * Priority:
 * 1. Explicit `values` → used as the patch directly.
 * 2. Otherwise the initial snapshot (or config defaults as a fallback),
 *    then the group's reset transformer (if any) is applied.
 */
export function buildResetPatch(
  groupNode: AnyConfigNode,
  initialValueMap: WeakMap<object, unknown> | undefined,
  values: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (values !== undefined) return values;

  const base = initialValueMap
    ? collectInitialSnapshot(groupNode, initialValueMap)
    : collectDefaults(groupNode);

  if (typeof groupNode.reset === "function") {
    return (groupNode.reset as (v: Record<string, unknown>) => Record<string, unknown>)(base);
  }

  return base;
}
