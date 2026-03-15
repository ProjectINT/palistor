/** Является ли узел листовым (имеет "value"). */
export function isLeaf(node: object): boolean {
  return "value" in (node as Record<string, unknown>);
}

/** Является ли узел групповым (нет "value"). */
export function isGroup(node: object): boolean {
  return !isLeaf(node);
}

/** Утилитарный класс для проверки типа узла. Инициализируется без аргументов. */
export class NodeUtils {
  isLeaf = isLeaf;
  isGroup = isGroup;
}
