/** Является ли узел листовым (имеет "value"). */
export function isLeaf(node: object): boolean {
  return "value" in (node as Record<string, unknown>);
}

/** Является ли узел групповым (нет "value"). */
export function isGroup(node: object): boolean {
  return !isLeaf(node);
}

/**
 * Является ли узел списком (массив длины 1-2).
 * array[0] — template (обычная группа), array[1] — опциональный listConfig.
 */
export function isListNode(node: unknown): node is readonly [object, ...unknown[]] {
  return Array.isArray(node) && node.length >= 1 && node.length <= 2;
}

/** Утилитарный класс для проверки типа узла. Инициализируется без аргументов. */
export class NodeUtils {
  isLeaf = isLeaf;
  isGroup = isGroup;
  isListNode = isListNode;
}
