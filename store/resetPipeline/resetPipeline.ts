import type { AnyConfigNode } from "../store/types";
import type { Palistor } from "../store/palistor";
import { applyPatch } from "../applyPatch/applyPatch";
import { setGroupRevalidate, captureInitialValues } from "../dirtyTracking";
import { recomputeAndNotify } from "../compute/recompute";
import { buildResetPatch } from "./buildResetPatch";

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
  constructor(private readonly kernel: Palistor<any>) {}

  execute(groupNode: AnyConfigNode, values?: Record<string, unknown>): void {
    const nodeState = this.kernel.nodes.nodeState;
    const initialValueMap = this.kernel.dirty.initialValueMap;
    const valuesCache = this.kernel.values;

    const patch = buildResetPatch(groupNode, initialValueMap, values);

    const changed = applyPatch(groupNode, nodeState, patch, new Set(), valuesCache);

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
  }
}
