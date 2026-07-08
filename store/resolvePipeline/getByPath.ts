/**
 * Read a dot-separated path (e.g. "user.address.city") from a nested object.
 * Returns `undefined` if any segment is missing or not an object.
 *
 * Used to compare the values a resolver read at attempt start against the live
 * values when it returns — to detect a dependency that changed while the
 * resolver was in flight (see executeResolve / executeListResolve).
 */
export function getByPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}
