/**
 * Recompute all computed props, merge with previously changed nodes
 * and notify subscribers.
 *
 * Encapsulates the pattern: recomputeAll → merge changed → notifyChanged.
 */
export function recomputeAndNotify(
  changed: Set<object>,
  recompute: () => Set<object>,
  notifyChanged: (changed: Set<object>) => void,
): void {
  const recomputed = recompute();
  for (const n of changed) recomputed.add(n);
  notifyChanged(recomputed);
}
