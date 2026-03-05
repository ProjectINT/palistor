import { collectValues, type AnyConfigNode } from "./collectValues";
import { applyPatch } from "./applyPatch";
import type { FieldState } from "./compute";

export interface OnChangeDeps {
  rootConfig: AnyConfigNode;
  nodeState: WeakMap<object, FieldState>;
  nodePaths: WeakMap<object, string>;
  nodeParents: WeakMap<object, object>;
  recomputeAll: () => Set<object>;
  notifyChanged: (changed: Set<object>) => void;
}

/**
 * Поднимается от изменённого узла к корню, собирая все группы с `onChange`.
 */
function findOnChangeAncestors(
  node: object,
  nodeParents: WeakMap<object, object>,
): AnyConfigNode[] {
  const result: AnyConfigNode[] = [];
  let current = nodeParents.get(node);

  while (current) {
    if (typeof (current as AnyConfigNode).onChange === "function") {
      result.push(current as AnyConfigNode);
    }
    current = nodeParents.get(current);
  }

  return result;
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
  const { rootConfig, nodeState, nodePaths, nodeParents, recomputeAll, notifyChanged } = deps;

  const ancestors = findOnChangeAncestors(node, nodeParents);
  if (ancestors.length === 0) return;

  const nodePath = nodePaths.get(node) ?? "";

  for (const ancestor of ancestors) {
    const ancestorPath = nodePaths.get(ancestor) ?? "";
    const fieldKey = ancestorPath
      ? nodePath.slice(ancestorPath.length + 1)
      : nodePath;

    const allValues = collectValues(rootConfig, nodeState);

    // Fire-and-forget: не ждём результат, не блокируем pipeline
    Promise.resolve(
      (ancestor.onChange as Function)({ fieldKey, newValue, previousValue, allValues }),
    )
      .then((patch) => {
        if (patch && typeof patch === "object" && Object.keys(patch as object).length > 0) {
          const patchChanged = applyPatch(
            ancestor,
            nodeState,
            patch as Record<string, unknown>,
          );
          if (patchChanged.size > 0) {
            const recomputed = recomputeAll();
            for (const n of patchChanged) recomputed.add(n);
            notifyChanged(recomputed);
          }
        }
      })
      .catch(() => {
        // onChange ошибки не блокируют работу — fire-and-forget
      });
  }
}
