import type { MappableKey } from "../constants";
import {
  FLOW_SPREAD_KEYS,
  FLOW_STEPS_PROP,
  GROUP_SPREAD_KEYS,
  LIST_SPREAD_KEYS,
  SPREADABLE_FIELD_STATE_PROPS,
} from "../constants";
import type { AnyConfigNode, FieldMapping } from "../store/types";
import { isLeafNode } from "../traversal";
import { isListNode } from "../store/NodeRegistry/nodeUtils";

/**
 * Computes which keys are visible on the proxy for a given node.
 *
 * Leaf:  all SPREADABLE_FIELD_STATE_PROPS + keys(componentProps).
 * List:  LIST_SPREAD_KEYS (items, length, loading, add, remove, …).
 * Group: GROUP_SPREAD_KEYS (submitting, dirty, loading, submit, reset, …).
 *
 * `fwd` (internal → external) projects mappable keys to their external names.
 * `fwd[k] ?? k` decides what to rename by itself: `value`/`dirty`/`loading`
 * etc. get projected when configured; `submit`/`items`/`componentProps` never
 * appear in the map. Empty `fwd` → identity → unchanged behavior.
 */
export function computeProxyKeys(node: unknown, fwd: FieldMapping = {}): string[] {
  const map = (keys: string[]): string[] => keys.map((k) => fwd[k as MappableKey] ?? k);

  if (isListNode(node)) return map(LIST_SPREAD_KEYS);

  const configNode = node as AnyConfigNode;
  if (isLeafNode(configNode)) {
    return map([
      ...SPREADABLE_FIELD_STATE_PROPS,
      ...Object.keys((configNode.componentProps as Record<string, unknown>) ?? {}),
    ]);
  }

  // Flow node (defineFlow): group + flow navigation keys.
  if (Array.isArray((configNode as Record<string, unknown>)[FLOW_STEPS_PROP])) {
    return map([...GROUP_SPREAD_KEYS, ...FLOW_SPREAD_KEYS]);
  }

  return map(GROUP_SPREAD_KEYS);
}
