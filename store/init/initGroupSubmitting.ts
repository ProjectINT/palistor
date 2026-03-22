import type { FieldState } from "../compute/index";
import type { AnyConfigNode } from "../store/types";
import { walkFull } from "../traversal";

/**
 * Инициализирует submitting: false, dirty: false, revalidate: false
 * в nodeState для корневого и всех вложенных групповых узлов.
 */
export function initGroupSubmitting(
  node: AnyConfigNode,
  nodeState: WeakMap<object, FieldState>,
) {
  // Инициализируем сам корневой узел (walkFull его не посещает)
  initGroupNode(node, nodeState);

  walkFull(node, {
    onLeaf() {}, // листья пропускаем
    onGroupEnter(groupNode) {
      initGroupNode(groupNode as AnyConfigNode, nodeState);
    },
  });
}

function initGroupNode(node: AnyConfigNode, nodeState: WeakMap<object, FieldState>) {
  const existing = nodeState.get(node);
  if (existing) {
    nodeState.set(node, {
      ...existing,
      submitting: existing.submitting ?? false,
      dirty: existing.dirty ?? false,
      revalidate: existing.revalidate ?? false,
    });
  } else {
    nodeState.set(node, {
      value: undefined,
      isVisible: true,
      isRequired: false,
      isDisabled: false,
      isReadOnly: false,
      submitting: false,
      dirty: false,
      revalidate: false,
    });
  }
}
