import type { AnyConfigNode } from "../store/types";
import type { WriteResult } from "./types";
import type { Palistor } from "../store/palistor";
import { formatValue } from "./formatValue";
import { storeValue } from "./storeValue";
import { runSetter } from "./runSetter";
import { mergeChanged } from "./mergeChanged";
import { isLeafNode } from "../traversal";
import type { FieldState } from "../compute/index";

export type { WriteResult } from "./types";
export type { Setter } from "./types";
export { formatValue } from "./formatValue";
export { formatPatch } from "./formatPatch";
export { storeValue } from "./storeValue";
export { runSetter } from "./runSetter";
export { mergeChanged } from "./mergeChanged";

export interface WriteOptions {
  /** templateField — используется для entity-leaf: правила берутся из шаблона, хранилище — из entityLeaf. */
  via?: AnyConfigNode;
}

/**
 * WritePipeline — полный write pipeline: format → store → (setter?) → recompute → merge changed.
 *
 * Всегда записывает значение в текущий узел через storeValue.
 * Если у узла есть setter — дополнительно патчит зависимые поля.
 *
 * При opts.via — entity-mode: правила (formatter, setter) берутся из templateField,
 * хранилище и recompute работают по entityLeaf (view.storage).
 */
export class WritePipeline {
  constructor(private readonly kernel: Palistor<any>) {}

  execute(
    node: AnyConfigNode,
    rawValue: unknown,
    previousValue?: unknown,
    opts?: WriteOptions,
  ): WriteResult | null {
    const view = this.kernel.nodes.getView(node, opts?.via);
    const isEntityMode = opts?.via !== undefined;
    const nodeState = this.kernel.nodes.nodeState;
    const valuesCache = this.kernel.values;

    // Фаза 1: Форматирование (entity: parentValues из view; config: из valuesCache)
    const allValues = isEntityMode ? view.parent.getValues() : valuesCache.values;
    const processedValue = formatValue(rawValue, view.rules, allValues);

    // Фаза 1.5: Быстрый выход — значение не изменилось
    const currentState = nodeState.get(view.storage);
    if (currentState && Object.is(processedValue, currentState.value)) {
      return { changed: new Set<object>(), skipped: true };
    }

    // Фаза 2: Прямая запись значения
    const stored = storeValue(view.storage, processedValue, nodeState, valuesCache);
    if (!stored) return null;

    // Entity sync: держим raw-значение entityLeaf в актуальном состоянии
    // (нужно для walkAndSyncEntityNode при повторном upsert)
    if (isEntityMode) {
      (view.storage as unknown as { value: unknown }).value = processedValue;
    }

    // Фаза 2.5: Setter-ветка — патч зависимых полей
    let patchedNodes: Set<object>;
    if (typeof view.rules.setter === "function") {
      if (isEntityMode) {
        // Entity mode: сиблинги живут в entity-дереве (не в config)
        const entityParent = this.kernel.nodes.nodeParents.get(view.storage as object) as
          | Record<string, unknown>
          | undefined;
        patchedNodes = entityParent
          ? this._applyEntitySetterPatch(
              view.rules.setter as Function,
              processedValue,
              allValues,
              previousValue,
              entityParent,
              nodeState,
              valuesCache,
            )
          : new Set<object>();
      } else {
        const parentNode = (this.kernel.nodes.nodeParents.get(node) ?? this.kernel.rootConfig) as AnyConfigNode;
        const parentPath = this.kernel.nodes.nodePaths.get(parentNode);
        patchedNodes = runSetter(node, processedValue, parentNode, nodeState, valuesCache, parentPath, previousValue);
      }
    } else {
      patchedNodes = new Set<object>();
    }

    // Фаза 3: Таргетированный пересчёт затронутых групп
    const changedSoFar = new Set<object>([view.storage]);
    for (const n of patchedNodes) changedSoFar.add(n);
    const recomputedNodes = this.kernel.recompute(changedSoFar);

    // Фаза 4: Объединение всех изменённых узлов
    return { changed: mergeChanged(view.storage, patchedNodes, recomputedNodes) };
  }

  /** Применить setter-патч к сиблингам entity leaf (storage-деревo, не template). */
  private _applyEntitySetterPatch(
    setter: Function,
    processedValue: unknown,
    parentValues: Record<string, unknown>,
    previousValue: unknown,
    entityParent: Record<string, unknown>,
    nodeState: WeakMap<object, FieldState>,
    valuesCache: import("../valuesCache/valuesCache").ValuesCache,
  ): Set<object> {
    const patch = setter(processedValue, parentValues, previousValue) as unknown;
    if (!patch || typeof patch !== "object") {
      console.error("[Palistor] entity setter must return an object, got:", typeof patch);
      return new Set();
    }
    const patchedNodes = new Set<object>();
    for (const k of Object.keys(patch as object)) {
      if (k === "id") continue;
      const entityField = entityParent[k];
      if (entityField && typeof entityField === "object" && isLeafNode(entityField as object)) {
        const patchValue = (patch as Record<string, unknown>)[k];
        const stored = storeValue(
          entityField as unknown as AnyConfigNode,
          patchValue,
          nodeState,
          valuesCache,
        );
        if (stored) {
          (entityField as { value: unknown }).value = patchValue;
          patchedNodes.add(entityField as object);
        }
      }
    }
    return patchedNodes;
  }
}
