import type { MappableKey } from "../constants";
import { GROUP_SPREAD_KEYS, LIST_SPREAD_KEYS, SPREADABLE_FIELD_STATE_PROPS } from "../constants";
import type { AnyConfigNode, FieldMapping } from "../store/types";
import { isLeafNode } from "../traversal";
import { isListNode } from "../store/NodeRegistry/nodeUtils";

/**
 * Вычисляет, какие ключи должны быть видны в прокси для данного узла.
 *
 * Для листа:   все SPREADABLE_FIELD_STATE_PROPS + keys(componentProps).
 * Для списка:  LIST_SPREAD_KEYS (items, length, loading, add, remove, …).
 * Для группы:  GROUP_SPREAD_KEYS (submitting, dirty, loading, submit, reset, …).
 *
 * `fwd` (internal → external) проецирует mappable-ключи в их external-имена.
 * `fwd[k] ?? k` сам разбирается, что переименовывать: `value`/`dirty`/`loading`
 * и т.д. спроецируются, если заданы; `submit`/`items`/`componentProps` — нет
 * (их в карте не бывает). Пустой `fwd` → identity → поведение без изменений.
 */
export function computeProxyKeys(node: unknown, fwd: FieldMapping = {}): string[] {
  const map = (keys: string[]): string[] => keys.map((k) => fwd[k as MappableKey] ?? k);

  if (isListNode(node)) return map(LIST_SPREAD_KEYS);

  const configNode = node as AnyConfigNode;
  return isLeafNode(configNode)
    ? map([
        ...SPREADABLE_FIELD_STATE_PROPS,
        ...Object.keys((configNode.componentProps as Record<string, unknown>) ?? {}),
      ])
    : map(GROUP_SPREAD_KEYS);
}
