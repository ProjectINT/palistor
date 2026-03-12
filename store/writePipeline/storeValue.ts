import type { AnyConfigNode } from "../store/types";
import type { FieldState } from "../compute/index";
import { updateValuesCacheEntry, type ValuesCache } from "../valuesCache/valuesCache";

/**
 * Фаза 2: Сохранение значения в nodeState.
 *
 * Иммутабельно обновляет FieldState: создаёт новый объект с новым value.
 * Возвращает true если запись прошла, false если узел не зарегистрирован.
 */
export function storeValue(
  node: AnyConfigNode,
  processedValue: unknown,
  nodeState: WeakMap<object, FieldState>,
  valuesCache?: ValuesCache,
): boolean {
  const state = nodeState.get(node);
  if (!state) return false;

  nodeState.set(node, { ...state, value: processedValue });
  if (valuesCache) updateValuesCacheEntry(valuesCache, node, processedValue);
  return true;
}
