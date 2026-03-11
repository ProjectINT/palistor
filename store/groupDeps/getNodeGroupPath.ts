/**
 * Определить путь группы, к которой принадлежит узел.
 *
 * - Листовой узел (есть "value") → путь родительской группы
 * - Групповой узел → свой собственный путь
 * - Root → ""
 */
export function getNodeGroupPath(
  node: object,
  nodeParents: WeakMap<object, object>,
  nodePaths: WeakMap<object, string>,
): string {
  // Групповой узел → его собственный путь
  if (!("value" in (node as Record<string, unknown>))) {
    return nodePaths.get(node) ?? "";
  }
  // Листовой → путь родительской группы
  const parent = nodeParents.get(node);
  if (!parent) return "";
  return nodePaths.get(parent) ?? "";
}
