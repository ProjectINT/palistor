import { FIELD_STATE_PROPS, CONFIG_PROPS } from "../constants";
import { INTERNAL_CONFIG_KEYS } from "./internalConfigKeys";
import type { AnyConfigNode } from "../collectValues";
import type { FieldState } from "../compute";

/**
 * Вычислить «публичные» ключи узла прокси для ownKeys/spread.
 *
 * Для листового узла (есть state): FIELD_STATE_PROPS + onValueChange + componentProps children.
 * Для группового узла: FIELD_STATE_PROPS (из state, если есть) + дочерние ключи-объекты.
 */
export function computeProxyKeys(node: AnyConfigNode, nodeState: WeakMap<object, FieldState>): string[] {
  const isLeaf = "value" in node;
  const keys: string[] = [];

  if (isLeaf) {
    // Листовой узел — отдаём вычисленное состояние + onValueChange
    for (const k of FIELD_STATE_PROPS) keys.push(k);
    keys.push("onValueChange");

    // componentProps — дополнительные пропсы для UI-компонента
    if (node.componentProps && typeof node.componentProps === "object") {
      for (const k of Object.keys(node.componentProps as Record<string, unknown>)) {
        keys.push(k);
      }
    }
  } else {
    // Групповой узел — состояние группы (если есть) + дочерние ключи
    const state = nodeState.get(node);
    if (state) {
      // У группы могут быть isVisible, isRequired, etc.
      for (const k of FIELD_STATE_PROPS) {
        if ((state as any)[k] !== undefined) keys.push(k);
      }
    }

    // Дочерние ключи-объекты (вложенные поля/группы)
    for (const k of Object.keys(node)) {
      if (INTERNAL_CONFIG_KEYS.has(k) || CONFIG_PROPS.has(k)) continue;
      const child = node[k];
      if (child && typeof child === "object") keys.push(k);
    }
  }

  return keys;
}
