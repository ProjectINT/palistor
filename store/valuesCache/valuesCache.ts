import { CONFIG_PROPS } from "../constants";
import type { AnyConfigNode } from "../store/types";
import type { FieldState } from "../compute/index";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ValuesCache {
  /** Корневой объект значений — всегда актуальный, мутабельный. */
  readonly values: Record<string, unknown>;
  /** Маппинг config-node → { parent, key } для O(1) обновления. */
  readonly nodeSlot: WeakMap<object, { parent: Record<string, unknown>; key: string }>;
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

  function walk(node: AnyConfigNode, target: Record<string, unknown>) {
    for (const key of Object.keys(node)) {
      if (CONFIG_PROPS.has(key)) continue;

      const child = node[key] as AnyConfigNode;
      if (!child || typeof child !== "object") continue;

      if ("value" in child) {
        target[key] = nodeState.get(child)?.value ?? "";
        nodeSlot.set(child, { parent: target, key });
      } else {
        const group: Record<string, unknown> = {};
        target[key] = group;
        walk(child, group);
      }
    }
  }

  walk(rootConfig, values);
  return { values, nodeSlot };
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
