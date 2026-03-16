import { CONFIG_PROPS } from "../constants";
import type { AnyConfigNode } from "../store/types";

/**
 * Рекурсивно собирает значения по умолчанию из конфига.
 *
 * Для листовых узлов:
 * - статическое значение → берётся как есть
 * - функция (computed) → "" как fallback
 *
 * Останавливается на вложенных группах с собственным `reset` (reset boundary).
 */
export function collectDefaults(node: AnyConfigNode): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(node)) {
    if (CONFIG_PROPS.has(key)) continue;

    const child = node[key] as AnyConfigNode;
    if (!child || typeof child !== "object") continue;
    if (Array.isArray(child)) continue; // ListNode — пропускаем, обрабатывается в фазе 2

    if ("value" in child) {
      const raw = child.value;
      result[key] = typeof raw === "function" ? "" : raw;
    } else {
      if (typeof child.reset === "function") continue;
      result[key] = collectDefaults(child);
    }
  }

  return result;
}
