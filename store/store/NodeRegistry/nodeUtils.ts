import { isLeafNode, isGroupNode } from "../../traversal/nodeClassifier";
export { isLeafNode, isGroupNode } from "../../traversal/nodeClassifier";
/**
 * Является ли узел списком (массив длины 1-2).
 * array[0] — template (обычная группа), array[1] — опциональный listConfig.
 *
 * NOTE: Более строгая проверка чем traversal.isListNode (длина 1-2).
 * Используется при построении proxy и разрастании keys.
 */
export function isListNode(node: unknown): node is readonly [object, ...unknown[]] {
  return Array.isArray(node) && node.length >= 1 && node.length <= 2;
}

/** Утилитарный класс для проверки типа узла. Инициализируется без аргументов. */
export class NodeUtils {
  isLeafNode = isLeafNode;
  isGroupNode = isGroupNode;
  isListNode = isListNode;
}

