import { configKeys, isLeafNode, isListNode } from "../traversal";
import type { AnyConfigNode } from "../store/types";
import type { FieldState } from "../compute/index";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ValuesCache {
  /** Корневой объект значений — всегда актуальный, мутабельный. */
  readonly values: Record<string, unknown>;
  /** Маппинг config-node → { parent, key } для O(1) обновления. */
  readonly nodeSlot: WeakMap<object, { parent: Record<string, unknown>; key: string }>;
  /** Маппинг group config-node → соответствующий вложенный объект values. */
  readonly groupSlot: WeakMap<object, Record<string, unknown>>;
}

// ─── Build ───────────────────────────────────────────────────────────────────

/**
 * Построить начальный кеш значений из дерева конфига + nodeState.
 * Вызывается ОДИН раз после registerNodes.
 *
 * Обходит дерево конфига и дополнительно
 * запоминает «слот» каждого листового узла для O(1) обновлений.
 */
export function buildValuesCache(
  rootConfig: AnyConfigNode,
  nodeState: WeakMap<object, FieldState>,
): ValuesCache {
  const values: Record<string, unknown> = {};
  const nodeSlot = new WeakMap<object, { parent: Record<string, unknown>; key: string }>();
  const groupSlot = new WeakMap<object, Record<string, unknown>>();

  groupSlot.set(rootConfig as object, values);

  function walk(node: AnyConfigNode, target: Record<string, unknown>) {
    for (const key of configKeys(node as Record<string, unknown>)) {
      const child = node[key] as AnyConfigNode;
      if (!child || typeof child !== "object") continue;
      if (isListNode(child)) {
        // ListNode: register empty array in values + nodeSlot for later updates
        const emptyArray: unknown[] = [];
        target[key] = emptyArray;
        nodeSlot.set(child as unknown as object, { parent: target, key });
        continue;
      }

      if (isLeafNode(child)) {
        target[key] = nodeState.get(child)?.value ?? "";
        nodeSlot.set(child, { parent: target, key });
      } else {
        const group: Record<string, unknown> = {};
        target[key] = group;
        groupSlot.set(child as object, group);
        // Also register group in nodeSlot so virtual leaves (group nodes with
        // computed props like isVisible) can resolve their parent-scoped values.
        nodeSlot.set(child, { parent: target, key });
        walk(child, group);
      }
    }
  }

  walk(rootConfig, values);
  return { values, nodeSlot, groupSlot };
}

// ─── Update ──────────────────────────────────────────────────────────────────

/**
 * Обновить одно значение в кеше — O(1).
 * Вызывается при каждой записи value в nodeState.
 */
export function updateValuesCacheEntry(
  cache: ValuesCache,
  node: object,
  newValue: unknown,
): void {
  const slot = cache.nodeSlot.get(node);
  if (slot) slot.parent[slot.key] = newValue;
}
