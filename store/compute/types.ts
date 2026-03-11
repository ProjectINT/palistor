/**
 * Полное вычисленное состояние одного поля.
 *
 * Хранится в WeakMap<configNode, FieldState>. Все функции из конфига
 * (isVisible, isRequired, validate…) уже вызваны, результат — чистые значения.
 */
export interface FieldState {
  value: unknown;
  label?: string;
  placeholder?: string;
  description?: string;
  isRequired: boolean;
  isReadOnly: boolean;
  isDisabled: boolean;
  isVisible: boolean;
  isInvalid?: boolean;
  errorMessage?: string;
  /** true while submit pipeline is running (group nodes only). */
  submitting?: boolean;
  /**
   * Per-field: value differs from initial.
   * Per-group: at least one descendant leaf is dirty.
   */
  dirty?: boolean;
  /**
   * Group-level flag: when true, validation errors are computed and shown.
   * Before first submit attempt: false (errors hidden).
   * After failed submit: true (live validation on every change).
   * Leaves inherit this from their parent group during recompute.
   */
  revalidate?: boolean;
  /**
   * true while async resolver is loading (group nodes with resolve only).
   */
  loading?: boolean;
}
