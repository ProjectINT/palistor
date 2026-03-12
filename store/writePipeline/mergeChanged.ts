/**
 * Объединить все источники изменений в один Set.
 *
 * — currentNode: всегда считается изменённым (пользователь явно туда писал)
 * — patchedNodes: узлы, обновлённые setter-патчем
 * — recomputedNodes: узлы, пересчитанные recomputeAll
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
