import type { AnyConfigNode } from "../types";
import { collectDefaults } from "./collectDefaults";
import { collectInitialSnapshot } from "../dirtyTracking";

/**
 * Строит патч для сброса группы.
 *
 * Приоритет:
 * 1. Если переданы явные `values` → используются как патч напрямую.
 * 2. Иначе берётся initial snapshot (или defaults из конфига как fallback),
 *    после чего применяется reset-трансформер группы (если задан).
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
