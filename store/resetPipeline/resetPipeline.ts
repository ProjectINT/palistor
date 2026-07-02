import type { AnyConfigNode } from "../store/types";
import type { Palistor } from "../store/palistor";
import { applyPatch } from "../applyPatch/applyPatch";
import { setGroupRevalidate, captureInitialValues } from "../dirtyTracking";
import { recomputeAndNotify } from "../compute/recompute";
import { buildResetPatch } from "./buildResetPatch";
import { resetFlowNavForSubtree } from "../flow/flowNavigation";

/**
 * ResetPipeline — сброс значений группового узла.
 *
 * - Если `values` передан явно — применяется как патч (новая baseline → dirty = false).
 * - Иначе восстанавливается initial snapshot (или config defaults как fallback),
 *   с опциональной трансформацией через reset-функцию группы.
 *
 * После сброса:
 * - revalidate = false (очистка режима валидации)
 * - полный пересчёт вычисляемых свойств + уведомление подписчиков
 */
export class ResetPipeline {
  constructor(private readonly kernel: Palistor<any, any>) {}

  execute(groupNode: AnyConfigNode, values?: Record<string, unknown>): void {
    const nodeState = this.kernel.nodes.nodeState;
    const initialValueMap = this.kernel.dirty.initialValueMap;
    const valuesCache = this.kernel.values;

    // При полном сбросе формы очищаем состояния резолва entity-полей,
    // чтобы они заново выполнились при загрузке сущностей через list resolver.
    if (groupNode === this.kernel.rootConfig) {
      this.kernel.resolveManager.entityStates.clearAll();
    }

    const patch = buildResetPatch(groupNode, initialValueMap, values);

    const changed = applyPatch(groupNode, nodeState, patch, new Set(), valuesCache);

    // C2: при полном сбросе восстанавливаем состав per-entity списков к initial
    // и бампаем версии их EntityListState-узлов → React перерисует списки.
    // C3: пересинхронизируем projectionObj владельца — getValues() вернёт initial.
    if (groupNode === this.kernel.rootConfig) {
      for (const { state } of this.kernel.entityRegistry.resetEntityListStates()) {
        this.kernel.syncListValuesCache(state);
        changed.add(state as unknown as object);
      }
    }

    if (values !== undefined && initialValueMap) {
      captureInitialValues(groupNode, nodeState, initialValueMap);
    }

    const revalidateChanged = setGroupRevalidate(groupNode, false, nodeState);
    for (const n of revalidateChanged) changed.add(n);

    recomputeAndNotify(
      changed,
      () => this.kernel.recompute(),
      (c) => this.kernel.notifyChanged(c),
    );

    // Flow: сброс навигации флоу внутри поддерева сброса — первый шаг снова
    // активен, resolve-состояния шагов idle, entry lifecycle первого шага
    // выполняется заново (Resolved Decision 16).
    resetFlowNavForSubtree(this.kernel, groupNode);
  }
}
