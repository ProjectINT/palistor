import { type FieldState } from "./compute";
import { CONFIG_PROPS } from "./constants";

/**
 * Внутренний тип для рекурсивного обхода дерева конфига.
 * Используется только внутри этого модуля.
 */
export interface AnyConfigNode {
  [key: string]: AnyConfigNode | unknown;
}

/**
 * Рекурсивно собирает текущие значения всех полей в вложенный объект.
 *
 * Алгоритм:
 *   - Итерируется по ключам узла, пропуская служебные (CONFIG_PROPS).
 *   - Если дочерний узел — листовой (содержит "value") → берёт value из nodeState.
 *   - Иначе → рекурсирует в него как в группу.
 *
 * Используется для: передачи в compute-функции, getValues(), submit.
 *
 * @param node      — текущий узел конфига (корень или группа)
 * @param nodeState — WeakMap с вычисленными FieldState для каждого листового узла
 */
export function collectValues(
  node: AnyConfigNode,
  nodeState: WeakMap<object, FieldState>,
): Record<string, unknown> {
  const result = new Map<string, unknown>();

  for (const key of Object.keys(node)) {
    // Пропускаем служебные ключи узла конфига (value, label, validate, formatter…).
    // Эти ключи описывают само поле, а не его дочерние узлы — включать их
    // в обход дерева не нужно, иначе мы попытаемся рекурсивно обойти, например,
    // функцию-валидатор как будто она является вложенной группой полей.
    if (CONFIG_PROPS.has(key)) continue;

    const child = node[key] as AnyConfigNode;

    if (!child || typeof child !== "object") continue;

    if ("value" in child) {
      // Листовой узел — берём value из вычисленного состояния
      result.set(key, nodeState.get(child)?.value ?? "");
    } else {
      // Групповой узел — рекурсируем, чтобы собрать вложенные значения
      result.set(key, collectValues(child, nodeState));
    }
  }

  return Object.fromEntries(result);
}
