import type { AnyConfigNode } from "../store/types";
import { CONFIG_PROPS } from "../constants";
import { formatValue } from "./formatValue";

/**
 * Отформатировать патч: рекурсивно обходит дерево конфига параллельно с деревом патча
 * и для каждого листового значения применяет formatter узла (если он есть).
 *
 * Возвращает новый объект-патч с отформатированными значениями.
 * Исходный patch не мутируется.
 *
 * Используется как первая фаза перед applyPatch:
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

    if ("value" in child) {
      // Листовой узел — прогоняем через formatter
      result[key] = formatValue(patchValue, child, allValues);
    } else if (patchValue && typeof patchValue === "object" && !Array.isArray(patchValue)) {
      // Групповой узел — рекурсия
      result[key] = formatPatch(child, patchValue as Record<string, unknown>, allValues);
    }
  }

  return result;
}
