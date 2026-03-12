/**
 * Compares two values for dirty checking.
 * Primitives use strict equality. Objects/arrays use JSON.stringify.
 * Treats null and undefined as equivalent (both "empty").
 */
export function isDirtyValue(current: unknown, initial: unknown): boolean {
  if (current === initial) return false;
  if (current == null && initial == null) return false;
  if (current == null || initial == null) return true;
  if (typeof current !== typeof initial) return true;
  if (typeof current === "object") {
    try {
      return JSON.stringify(current) !== JSON.stringify(initial);
    } catch {
      return true;
    }
  }
  return true;
}
