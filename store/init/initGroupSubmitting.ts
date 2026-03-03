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
    const updated = { ...existing };
    if (updated.submitting === undefined) updated.submitting = false;
    if (updated.dirty === undefined) updated.dirty = false;
    if (updated.revalidate === undefined) updated.revalidate = false;
    nodeState.set(node, updated);
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
    const child = node[key] as AnyConfigNode;
    if (!child || typeof child !== "object") continue;
    // Только группы (без value)
    if (!("value" in child)) {
      initGroupSubmitting(child, nodeState);
    }
  }
}
