import { type AnyConfigNode } from "../types";
import { applyPatch } from "../applyPatch/applyPatch";
import type { FieldState } from "../compute/index";
import { recomputeAndNotify } from "../compute/recompute";
import type { ValuesCache } from "../valuesCache";
import { findOnChangeAncestors } from "./findOnChangeAncestors";
import { computeFieldKey } from "./computeFieldKey";

export interface OnChangeDeps {
  rootConfig: AnyConfigNode;
  nodeState: WeakMap<object, FieldState>;
  nodePaths: WeakMap<object, string>;
  nodeParents: WeakMap<object, object>;
  recomputeAll: () => Set<object>;
  notifyChanged: (changed: Set<object>) => void;
  valuesCache: ValuesCache;
}

/**
 * Применяет патч, возвращённый onChange-обработчиком, к стору.
 * Пустой или примитивный патч игнорируется.
 */
export function applyOnChangeResult(
  patch: unknown,
  ancestor: AnyConfigNode,
  nodeState: WeakMap<object, FieldState>,
  recomputeAll: () => Set<object>,
  notifyChanged: (changed: Set<object>) => void,
  valuesCache: ValuesCache,
): void {
  if (!patch || typeof patch !== "object" || Object.keys(patch as object).length === 0) return;

  const patchChanged = applyPatch(
    ancestor,
    nodeState,
    patch as Record<string, unknown>,
    new Set(),
    valuesCache,
  );
  if (patchChanged.size > 0) {
    recomputeAndNotify(patchChanged, recomputeAll, notifyChanged);
  }
}

/**
 * Fire-and-forget вызов onChange хендлеров всех групп-предков.
 *
 * Для каждого предка с `onChange`:
 * - вычисляется `fieldKey` — путь изменённого поля относительно этого предка
 * - onChange вызывается асинхронно, не блокируя pipeline записи
 * - если onChange вернул объект-патч — он применяется к store
 *
 * Вызовы onChange могут конкурировать: каждый запуск fire-and-forget,
 * результаты применяются по мере поступления.
 */
export function fireOnChange(
  node: AnyConfigNode,
  newValue: unknown,
  previousValue: unknown,
  deps: OnChangeDeps,
): void {
  const { nodeState, nodePaths, nodeParents, recomputeAll, notifyChanged, valuesCache } = deps;

  const ancestors = findOnChangeAncestors(node, nodeParents);
  if (ancestors.length === 0) return;

  const nodePath = nodePaths.get(node) ?? "";

  for (const ancestor of ancestors) {
    const ancestorPath = nodePaths.get(ancestor) ?? "";
    const fieldKey = computeFieldKey(nodePath, ancestorPath);
    const allValues = valuesCache.values;

    // Fire-and-forget: не ждём результат, не блокируем pipeline
    Promise.resolve(
      (ancestor.onChange as Function)({ fieldKey, newValue, previousValue, allValues }),
    )
      .then((patch) => applyOnChangeResult(patch, ancestor, nodeState, recomputeAll, notifyChanged, valuesCache))
      .catch(() => {
        // onChange ошибки не блокируют работу — fire-and-forget
      });
  }
}
