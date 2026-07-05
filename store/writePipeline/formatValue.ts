import type { AnyConfigNode } from "../store/types";

/**
 * Phase 1: format the incoming value.
 *
 * If the node has a formatter — calls it with the raw value and the current
 * snapshot of all form values.
 * Without a formatter — returns the value as-is.
 *
 * Pure function: does not mutate nodeState, no side effects.
 */
export function formatValue(
  rawValue: unknown,
  node: AnyConfigNode,
  allValues: Record<string, unknown>,
): unknown {
  if (typeof node.formatter !== "function") return rawValue;

  return (node.formatter as (v: string | boolean, vals: Record<string, unknown>) => string | number | boolean)(
    rawValue as string | boolean,
    allValues,
  );
}
