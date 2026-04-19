import { type AnyConfigNode } from "../store/types";

/**
 * Собирает все узлы с `onChange` от самого узла вверх до корня.
 *
 * Порядок: сам узел (если есть onChange) первым, затем ближайший предок и т.д.
 */
export function findOnChangeNodes(
  node: object,
  nodeParents: WeakMap<object, object>,
): AnyConfigNode[] {
  const result: AnyConfigNode[] = [];

  // Сам узел
  if (typeof (node as AnyConfigNode).onChange === "function") {
    result.push(node as AnyConfigNode);
  }

  // Предки
  let current = nodeParents.get(node);
  while (current) {
    if (typeof (current as AnyConfigNode).onChange === "function") {
      result.push(current as AnyConfigNode);
    }
    current = nodeParents.get(current);
  }

  return result;
}
