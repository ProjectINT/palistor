import type { FieldState } from "./types";

/**
 * Shallow comparison of two FieldStates.
 */
export function fieldStateChanged(a: FieldState, b: FieldState): boolean {
  return (
    a.value       !== b.value        ||
    a.isVisible   !== b.isVisible    ||
    a.isRequired  !== b.isRequired   ||
    a.isDisabled  !== b.isDisabled   ||
    a.isReadOnly  !== b.isReadOnly   ||
    a.label       !== b.label        ||
    a.placeholder !== b.placeholder  ||
    a.description !== b.description  ||
    a.isInvalid   !== b.isInvalid    ||
    a.errorMessage!== b.errorMessage ||
    a.submitting  !== b.submitting   ||
    a.dirty       !== b.dirty        ||
    a.revalidate  !== b.revalidate   ||
    a.loading     !== b.loading
  );
}
