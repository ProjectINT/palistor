/**
 * Structural equality for values-cache data (primitives, plain objects, arrays,
 * Dates). Used to detect whether a value a resolver read actually changed while
 * it was in flight.
 *
 * Reference comparison is wrong here: `getValues()` returns a fresh
 * structuredClone on every call, so two clones of an unchanged array/object are
 * always `!==` — which would trigger an endless re-run loop.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }

  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return false;
  }

  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr !== bArr) return false;

  if (aArr && bArr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao);
  const bKeys = Object.keys(bo);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bo, key)) return false;
    if (!deepEqual(ao[key], bo[key])) return false;
  }
  return true;
}
