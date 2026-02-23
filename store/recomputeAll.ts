import { type FieldState, computeFieldState, fieldStateChanged } from "./compute";
import { collectValues, type AnyConfigNode } from "./collectValues";

/**
 * Пересчитать вычисленное состояние всех листовых полей.
 * Вызывается при init и после каждого SET .value.
 *
 * Возвращает Set узлов, чьё состояние изменилось (для notify).
 */
export function recomputeAll(
  rootConfig: AnyConfigNode,
  leafNodes: Array<{ node: AnyConfigNode }>,
  nodeState: WeakMap<object, FieldState>,
): Set<object> {
  const allValues = collectValues(rootConfig, nodeState);
  const changed = new Set<object>();

  for (const { node } of leafNodes) {
    const prev = nodeState.get(node);
    const currentValue = prev?.value ?? "";
    const next = computeFieldState(node, currentValue, allValues);

    // Проверяем, изменилось ли что-то
    if (prev && !fieldStateChanged(prev, next)) continue;

    nodeState.set(node, next);
    changed.add(node);
  }

  return changed;
}
