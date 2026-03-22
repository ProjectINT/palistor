import { CONFIG_PROPS } from "../constants";

/** Leaf node — объект с полем "value" */
export function isLeaf(node: object): node is { value: unknown } {
  return "value" in node;
}

/** Group node — объект БЕЗ "value", содержит дочерние узлы */
export function isGroup(node: object): boolean {
  return !Array.isArray(node) && !("value" in node);
}

/** List node — массив (entity-списки хранятся как Array) */
export function isListNode(node: unknown): node is unknown[] {
  return Array.isArray(node);
}

/**
 * Вернуть ключи узла, отфильтровав служебные CONFIG_PROPS.
 * Это заменяет повторяющийся паттерн:
 *   for (const key of Object.keys(node)) {
 *     if (CONFIG_PROPS.has(key)) continue;
 *     ...
 *   }
 */
export function configKeys(node: Record<string, unknown>): string[] {
  return Object.keys(node).filter(k => !CONFIG_PROPS.has(k));
}
