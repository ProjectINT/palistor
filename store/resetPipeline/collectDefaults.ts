import { configKeys, isLeafNode, isListNode } from "../traversal";
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

  for (const key of configKeys(node as Record<string, unknown>)) {
    const child = node[key] as AnyConfigNode;
    if (!child || typeof child !== "object") continue;
    if (isListNode(child)) continue; // ListNode — пропускаем, обрабатывается в фазе 2

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
