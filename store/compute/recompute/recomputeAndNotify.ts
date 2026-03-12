/**
 * Пересчитать все computed-свойства, объединить с ранее изменёнными узлами
 * и уведомить подписчиков.
 *
 * Инкапсулирует паттерн: recomputeAll → merge changed → notifyChanged.
 */
export function recomputeAndNotify(
  changed: Set<object>,
  recomputeAll: () => Set<object>,
  notifyChanged: (changed: Set<object>) => void,
): void {
  const recomputed = recomputeAll();
  for (const n of changed) recomputed.add(n);
  notifyChanged(recomputed);
}
