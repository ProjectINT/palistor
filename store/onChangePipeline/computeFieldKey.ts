/**
 * Вычисляет путь изменённого поля относительно предка-группы.
 *
 * Примеры:
 *   nodePath="form.address.city", ancestorPath="form" → "address.city"
 *   nodePath="name",              ancestorPath=""     → "name"
 */
export function computeFieldKey(nodePath: string, ancestorPath: string): string {
  if (!ancestorPath) return nodePath;
  return nodePath.slice(ancestorPath.length + 1);
}
