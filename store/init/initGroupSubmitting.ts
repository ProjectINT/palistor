import type { FieldState } from "../compute";
import type { AnyConfigNode } from "../collectValues";
import { CONFIG_PROPS } from "../constants";

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
  for (const key of Object.keys(node)) {
    if (CONFIG_PROPS.has(key)) continue;
    const child = node[key];
    if (!child || typeof child !== "object" || "value" in (child as object)) continue;
    initGroupSubmitting(child as AnyConfigNode, nodeState);
  }
}
