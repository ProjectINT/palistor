import { configKeys, isLeaf } from "../traversal";
import type { AnyConfigNode } from "../store/types";
import type { FieldState } from "../compute/index";

/**
 * Устанавливает флаг `revalidate` на узле-группе и рекурсивно распространяет его
 * на ВСЕ дочерние узлы — как на листовые поля, так и на вложенные группы.
 *
 * @param node       — узел конфига (группа или поле)
 * @param revalidate — значение флага, которое нужно установить
 * @param nodeState  — WeakMap с текущим состоянием каждого узла (FieldState)
 * @returns          — множество узлов, у которых флаг revalidate действительно изменился
 */
export function setGroupRevalidate(
  node: AnyConfigNode,
  revalidate: boolean,
  nodeState: WeakMap<object, FieldState>,
): Set<object> {
  const changed = new Set<object>();

  // Обновляем сам текущий узел.
  const state = nodeState.get(node);
  if (state && state.revalidate !== revalidate) {
    nodeState.set(node, { ...state, revalidate });
    changed.add(node);
  }

  for (const key of configKeys(node as Record<string, unknown>)) {
    const child = node[key] as AnyConfigNode;
    if (!child || typeof child !== "object") continue;

    if (isLeaf(child)) {
      const childState = nodeState.get(child);
      if (childState && childState.revalidate !== revalidate) {
        nodeState.set(child, { ...childState, revalidate });
        changed.add(child);
      }
    } else {
      const childChanged = setGroupRevalidate(child, revalidate, nodeState);
      for (const n of childChanged) changed.add(n);
    }
  }

  return changed;
}
