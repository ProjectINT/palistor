import type { AnyConfigNode } from "../store/types";
import type { FieldState } from "../compute/index";
import { applyPatch } from "../applyPatch/applyPatch";
import type { ValuesCache } from "../valuesCache/valuesCache";
import type { Setter } from "./types";

/**
 * Извлечь значения родительской группы из кеша.
 * Если parentPath пустой — вернуть корневые значения.
 */
function getParentValues(
  valuesCache: ValuesCache,
  parentPath: string | undefined,
): Record<string, unknown> {
  if (!parentPath) return valuesCache.values;
  let current: unknown = valuesCache.values;
  for (const segment of parentPath.split(".")) {
    current = (current as Record<string, unknown>)?.[segment];
  }
  return (current as Record<string, unknown>) ?? {};
}

/**
 * Фаза 3 (альтернативная ветка): Применение setter.
 *
 * Setter — дополнительный путь записи: возвращает патч для обновления
 * зависимых (sibling) полей после того, как текущее значение уже сохранено.
 *
 * Патч и values скоупятся к родительской группе узла (а не к root),
 * чтобы setter мог читать и патчить сиблинги напрямую.
 *
 * Если setter вернул не-объект — логирует ошибку, но не ломает рантайм.
 */
export function runSetter(
  node: AnyConfigNode,
  processedValue: unknown,
  parentNode: AnyConfigNode,
  nodeState: WeakMap<object, FieldState>,
  valuesCache: ValuesCache,
  parentPath: string | undefined,
  previousValue?: unknown,
): Set<object> {
  const parentValues = getParentValues(valuesCache, parentPath);

  const patch = (node.setter as Setter)(
    processedValue,
    parentValues,
    previousValue,
  );

  if (!patch || typeof patch !== "object") {
    console.error(
      `[Palistor] setter must return an object, got ${patch === null ? "null" : typeof patch}.`,
      { node, value: processedValue },
    );
    return new Set();
  }

  return applyPatch(parentNode, nodeState, patch, new Set(), valuesCache);
}
