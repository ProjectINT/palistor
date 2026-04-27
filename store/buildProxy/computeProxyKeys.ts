import { GROUP_SPREAD_KEYS, LIST_SPREAD_KEYS, SPREADABLE_FIELD_STATE_PROPS } from "../constants";
import type { AnyConfigNode } from "../store/types";
import { isLeafNode } from "../traversal";
import { isListNode } from "../store/NodeRegistry/nodeUtils";

/**
 * Вычисляет, какие ключи должны быть видны в прокси для данного узла.
 *
 * Для листа:   все SPREADABLE_FIELD_STATE_PROPS + keys(componentProps).
 * Для списка:  LIST_SPREAD_KEYS (items, length, loading, add, remove, …).
 * Для группы:  GROUP_SPREAD_KEYS (submitting, dirty, loading, submit, reset, …).
 */
export function computeProxyKeys(node: unknown): string[] {

  if (isListNode(node)) return LIST_SPREAD_KEYS;

  const configNode = node as AnyConfigNode;
  return isLeafNode(configNode)
    ? [
        ...SPREADABLE_FIELD_STATE_PROPS,
        ...Object.keys((configNode.componentProps as Record<string, unknown>) ?? {}),
      ]
    : GROUP_SPREAD_KEYS;
}
