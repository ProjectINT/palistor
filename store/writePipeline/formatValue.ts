import type { AnyConfigNode } from "../store/types";

/**
 * Фаза 1: Форматирование входного значения.
 *
 * Если у узла есть formatter — вызывает его, передавая сырое значение
 * и текущий snapshot всех значений формы.
 * Если formatter отсутствует — возвращает значение как есть.
 *
 * Чистая функция: не мутирует nodeState, не имеет побочных эффектов.
 */
export function formatValue(
  rawValue: unknown,
  node: AnyConfigNode,
  allValues: Record<string, unknown>,
): unknown {
  if (typeof node.formatter !== "function") return rawValue;

  return (node.formatter as (v: string | boolean, vals: Record<string, unknown>) => string | number | boolean)(
    rawValue as string | boolean,
    allValues,
  );
}
