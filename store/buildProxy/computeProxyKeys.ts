import { GROUP_SPREAD_KEYS, SPREADABLE_FIELD_STATE_PROPS } from "../constants";
import type { AnyConfigNode } from "../store/types";
import { NodeUtils } from "../store/NodeRegistry/nodeUtils";

/**
 * Вычисляет, какие ключи должны быть видны в прокси для данного узла.
 *
 * Для листа: все SPREADABLE_FIELD_STATE_PROPS + keys(componentProps).
 * Для группы: GROUP_SPREAD_KEYS (submitting, dirty, loading, submit, reset, …).
 */
export function computeProxyKeys(node: AnyConfigNode): string[] {

  const nodeUtils = new NodeUtils();

  return nodeUtils.isLeaf(node)
    ? [
        ...SPREADABLE_FIELD_STATE_PROPS,
        ...Object.keys((node.componentProps as Record<string, unknown>) ?? {}),
      ]
    : GROUP_SPREAD_KEYS;
}
