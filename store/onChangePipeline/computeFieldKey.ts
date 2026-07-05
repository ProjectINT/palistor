/**
 * Computes the changed field's path relative to the handler node.
 *
 * Examples:
 *   nodePath="form.address.city", handlerPath="form"              → "address.city"
 *   nodePath="name",              handlerPath=""                   → "name"
 *   nodePath="form.country",      handlerPath="form.country"      → "country"  (self)
 *   nodePath="name",              handlerPath="name"              → "name"     (self)
 */
export function computeFieldKey(nodePath: string, handlerPath: string): string {
  if (nodePath === handlerPath) {
    return nodePath.includes(".") ? nodePath.slice(nodePath.lastIndexOf(".") + 1) : nodePath;
  }
  if (!handlerPath) return nodePath;
  return nodePath.slice(handlerPath.length + 1);
}
