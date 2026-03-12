import type { AnyConfigNode } from "../store/types";
import type { FieldState } from "../compute/index";
import { applyPatch } from "../applyPatch/applyPatch";
import { setGroupRevalidate, captureInitialValues } from "../dirtyTracking";
import { recomputeAndNotify } from "../compute/recompute";
import type { ValuesCache } from "../valuesCache/valuesCache";
import { buildResetPatch } from "./buildResetPatch";

export interface ResetDeps {
  nodeState: WeakMap<object, FieldState>;
  recomputeAll: () => Set<object>;
  notifyChanged: (changed: Set<object>) => void;
  /** Optional: used to update initial snapshot after reset (for dirty tracking). */
  initialValueMap?: WeakMap<object, unknown>;
  valuesCache: ValuesCache;
}

/**
 * Сбросить группу (поддерево) к значениям по умолчанию.
 *
 * - Если `values` передан явно — применяется как патч (новая baseline → dirty = false).
 * - Иначе восстанавливается initial snapshot (или config defaults как fallback),
 *   с опциональной трансформацией через reset-функцию группы.
 *
 * После сброса:
 * - revalidate = false (очистка режима валидации)
 * - полный пересчёт вычисляемых свойств + уведомление подписчиков
 */
export function executeReset(
  groupNode: AnyConfigNode,
  deps: ResetDeps,
  values?: Record<string, unknown>,
): void {
  const { nodeState, recomputeAll, notifyChanged, initialValueMap, valuesCache } = deps;

  const patch = buildResetPatch(groupNode, initialValueMap, values);

  const changed = applyPatch(groupNode, nodeState, patch, new Set(), valuesCache);

  // Capture new initial snapshot BEFORE recomputeAndNotify so that recomputeDirty
  // (which runs inside notifyChanged) sees the new baseline → dirty = false.
  // Only needed for explicit values; restoring to initial leaves snapshot unchanged.
  if (values !== undefined && initialValueMap) {
    captureInitialValues(groupNode, nodeState, initialValueMap);
  }

  const revalidateChanged = setGroupRevalidate(groupNode, false, nodeState);
  for (const n of revalidateChanged) changed.add(n);

  recomputeAndNotify(changed, recomputeAll, notifyChanged);
}
