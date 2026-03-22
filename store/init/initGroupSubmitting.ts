import type { FieldState } from "../compute/index";
import type { AnyConfigNode } from "../store/types";
import { configKeys, isLeaf } from "../traversal";

/**
 * Инициализирует submitting: false, dirty: false, revalidate: false
 * в nodeState для корневого и всех вложенных групповых узлов.
 */
export function initGroupSubmitting(
  node: AnyConfigNode,
  nodeState: WeakMap<object, FieldState>,
) {
  // Для текущего узла (группового) — инициализируем management flags
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

  // Рекурсия в дочерние группы
  for (const key of configKeys(node as Record<string, unknown>)) {
    const child = node[key];
    if (!child || typeof child !== "object" || isLeaf(child as object)) continue;
    if (Array.isArray(child)) continue; // ListNode — пропускаем, обрабатывается в фазе 2
    initGroupSubmitting(child as AnyConfigNode, nodeState);
  }
}
