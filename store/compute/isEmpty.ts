/**
 * Checks if a value is "empty" for isRequired validation purposes.
 * Empty string, null, undefined, NaN → empty.
 */
export function isEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  if (typeof value === "number" && Number.isNaN(value)) return true;
  return false;
}
