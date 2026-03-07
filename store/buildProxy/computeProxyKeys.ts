import { GROUP_SPREAD_KEYS, SPREADABLE_FIELD_STATE_PROPS } from "../constants";
import type { AnyConfigNode } from "../collectValues";
import type { FieldState } from "../compute";

/**
 * Вычисляет, какие ключи должны быть видны в прокси для данного узла.
 *
 * Для листа: все SPREADABLE_FIELD_STATE_PROPS + keys(componentProps).
 * Для группы: GROUP_SPREAD_KEYS (submitting, dirty, loading, submit, reset, …).
 */
export function computeProxyKeys(node: AnyConfigNode, nodeState: WeakMap<object, FieldState>): string[] {
  const isLeaf = "value" in node;

  return isLeaf
    ? [
        ...SPREADABLE_FIELD_STATE_PROPS,
        ...Object.keys((node.componentProps as Record<string, unknown>) ?? {}),
      ]
    : GROUP_SPREAD_KEYS;
}
