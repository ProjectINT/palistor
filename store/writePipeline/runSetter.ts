import type { AnyConfigNode } from "../store/types";
import type { FieldState } from "../compute/index";
import { applyPatch } from "../applyPatch/applyPatch";
import type { ValuesCache } from "../valuesCache/valuesCache";
import type { Setter } from "./types";

/**
 * Фаза 3 (альтернативная ветка): Применение setter.
 *
 * Setter — дополнительный путь записи: возвращает патч для обновления
 * зависимых полей после того, как текущее значение уже сохранено.
 *
 * Если setter вернул не-объект — логирует ошибку, но не ломает рантайм.
 */
export function runSetter(
  node: AnyConfigNode,
  processedValue: unknown,
  rootConfig: AnyConfigNode,
  nodeState: WeakMap<object, FieldState>,
  valuesCache: ValuesCache,
  previousValue?: unknown,
): Set<object> {
  const patch = (node.setter as Setter)(
    processedValue,
    valuesCache.values,
    previousValue,
  );

  if (!patch || typeof patch !== "object") {
    console.error(
      `[Palistor] setter must return an object, got ${patch === null ? "null" : typeof patch}.`,
      { node, value: processedValue },
    );
    return new Set();
  }

  return applyPatch(rootConfig, nodeState, patch, new Set(), valuesCache);
}
