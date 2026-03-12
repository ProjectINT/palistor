import { type AnyConfigNode } from "../store/types";

/**
 * Поднимается от изменённого узла к корню, собирая все группы с `onChange`.
 *
 * Обходит цепочку родителей снизу вверх. Порядок в результате:
 * ближайший предок первым (снизу вверх).
 */
export function findOnChangeAncestors(
  node: object,
  nodeParents: WeakMap<object, object>,
): AnyConfigNode[] {
  const result: AnyConfigNode[] = [];
  let current = nodeParents.get(node);

  while (current) {
    if (typeof (current as AnyConfigNode).onChange === "function") {
      result.push(current as AnyConfigNode);
    }
    current = nodeParents.get(current);
  }

  return result;
}
