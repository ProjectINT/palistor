/**
 * Merge all change sources into a single Set.
 *
 * — currentNode: always considered changed (the user explicitly wrote to it)
 * — patchedNodes: nodes updated by a setter patch
 * — recomputedNodes: nodes recomputed by recomputeAll
 */
export function mergeChanged(
  currentNode: object,
  patchedNodes: Set<object>,
  recomputedNodes: Set<object>,
): Set<object> {
  const changed = new Set(recomputedNodes);
  for (const n of patchedNodes) changed.add(n);
  changed.add(currentNode);
  return changed;
}
