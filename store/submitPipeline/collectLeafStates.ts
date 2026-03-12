import { CONFIG_PROPS } from "../constants";
import type { AnyConfigNode } from "../store/types";
import type { FieldState } from "../compute/index";

/**
 * Собирает все листовые узлы поддерева с их путями и текущим состоянием.
 * Используется для валидации при submit.
 */
export function collectLeafStates(
  node: AnyConfigNode,
  nodeState: WeakMap<object, FieldState>,
  parentPath = "",
): Array<{ path: string; state: FieldState }> {
  const result: Array<{ path: string; state: FieldState }> = [];

  for (const key of Object.keys(node)) {
    if (CONFIG_PROPS.has(key)) continue;

    const child = node[key] as AnyConfigNode;
    if (!child || typeof child !== "object") continue;

    const path = parentPath ? `${parentPath}.${key}` : key;

    if ("value" in child) {
      const state = nodeState.get(child);
      if (state) result.push({ path, state });
    } else {
      result.push(...collectLeafStates(child, nodeState, path));
    }
  }

  return result;
}
