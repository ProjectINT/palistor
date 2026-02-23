import { FIELD_STATE_PROPS } from "./constants";
import type { AnyConfigNode } from "./collectValues";

/**
 * Проверяет, есть ли у узла вычисляемые свойства (функции isVisible, isRequired…).
 * Нужно для промежуточных узлов-групп (passport.isVisible).
 */
export function hasComputedProps(node: AnyConfigNode): boolean {
  for (const key of FIELD_STATE_PROPS) {
    if (key === "value") continue;
    if (node[key] !== undefined) return true;
  }
  return false;
}
