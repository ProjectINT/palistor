import { walkFull } from "../traversal";
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

  // Обновляем сам корневой узел (walkFull его не посещает).
  updateRevalidate(node, revalidate, nodeState, changed);

  walkFull(node, {
    onLeaf(leafNode) {
      updateRevalidate(leafNode, revalidate, nodeState, changed);
    },
    onGroupEnter(groupNode) {
      updateRevalidate(groupNode, revalidate, nodeState, changed);
    },
  });

  return changed;
}

function updateRevalidate(
  node: object,
  revalidate: boolean,
  nodeState: WeakMap<object, FieldState>,
  changed: Set<object>,
) {
  const state = nodeState.get(node);
  if (state && state.revalidate !== revalidate) {
    nodeState.set(node, { ...state, revalidate });
    changed.add(node);
  }
}
