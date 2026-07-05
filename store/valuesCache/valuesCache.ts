import { configKeys, isLeafNode, isListNode } from "../traversal";
import type { AnyConfigNode } from "../store/types";
import type { FieldState } from "../compute/index";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ValuesCache {
  /** Root values object — always current, mutable. */
  readonly values: Record<string, unknown>;
  /** config-node → { parent, key } mapping for O(1) updates. */
  readonly nodeSlot: WeakMap<object, { parent: Record<string, unknown>; key: string }>;
  /** group config-node → the corresponding nested values object. */
  readonly groupSlot: WeakMap<object, Record<string, unknown>>;
}

// ─── Build ───────────────────────────────────────────────────────────────────

/**
 * Build the initial values cache from the config tree + nodeState.
 * Called ONCE after registerNodes.
 *
 * Walks the config tree and additionally records each leaf node's "slot"
 * for O(1) updates.
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
        // Also register group in nodeSlot so nodes can resolve their parent-scoped values.
        nodeSlot.set(child, { parent: target, key });
        // Update group's nodeState.value to reference the group object (Phase 2).
        const state = nodeState.get(child);
        if (state) nodeState.set(child, { ...state, value: group });
        walk(child, group);
      }
    }
  }

  walk(rootConfig, values);
  return { values, nodeSlot, groupSlot };
}

// ─── Update ──────────────────────────────────────────────────────────────────

/**
 * Update a single cache value — O(1).
 * Called on every value write to nodeState.
 */
export function updateValuesCacheEntry(
  cache: ValuesCache,
  node: object,
  newValue: unknown,
): void {
  const slot = cache.nodeSlot.get(node);
  if (slot) slot.parent[slot.key] = newValue;
}
