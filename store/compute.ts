// ─── Вычисленное состояние поля ──────────────────────────────────────────────

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
  error?: boolean;
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
}

// ─── Вспомогательные функции ─────────────────────────────────────────────────

/**
 * Вычисляет одно свойство-флаг из конфига: если это функция — вызывает с values,
 * иначе возвращает как есть. Если undefined — возвращает defaultValue.
 */
export function resolveFlag(
  configValue: boolean | ((values: any) => boolean) | undefined,
  values: Record<string, any>,
  defaultValue: boolean,
): boolean {
  if (configValue === undefined) return defaultValue;
  if (typeof configValue === "function") return configValue(values);
  return configValue;
}

/**
 * Вычисляет строковое свойство (label, placeholder, description) из конфига.
 * Может быть строкой или функцией (translate, settings).
 *
 * Если translator зарегистрирован — реальный резолв происходит лениво
 * в proxy GET trap (buildProxy.ts). Здесь сохраняем fallback:
 * для функций — вызываем с identity → возвращаем ключ перевода.
 */
export function resolveString(
  configValue: string | ((translate: any, settings?: any) => string) | undefined,
  values: Record<string, any> = {},
): string | undefined {
  if (configValue === undefined) return undefined;
  if (typeof configValue === "function") {
    // identity — вернёт ключ как есть (fallback до регистрации translator)
    return configValue((v: string) => v, values);
  }
  return configValue;
}

/**
 * Checks if a value is "empty" for isRequired validation purposes.
 * Empty string, null, undefined, NaN → empty.
 */
function isEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  if (typeof value === "number" && Number.isNaN(value)) return true;
  return false;
}

/**
 * Вычисляет полное состояние одного поля на основе конфига и текущих values.
 *
 * @param revalidate — when false, validation is skipped (error/errorMessage stay undefined).
 *                     Submit pipeline always passes true to force validation.
 */
export function computeFieldState(
  configNode: Record<string, any>,
  currentValue: any,
  allValues: Record<string, any>,
  revalidate = true,
): FieldState {
  // Вычисляем флаги
  const isVisible  = resolveFlag(configNode.isVisible, allValues, true);
  const isRequired = resolveFlag(configNode.isRequired, allValues, false);
  const isDisabled = resolveFlag(configNode.isDisabled, allValues, false);
  const isReadOnly = resolveFlag(configNode.isReadOnly, allValues, false);

  // Строки
  const label       = resolveString(configNode.label, allValues);
  const placeholder = resolveString(configNode.placeholder, allValues);
  const description = resolveString(configNode.description, allValues);

  // Валидация — only when revalidate is true
  let error: boolean | undefined;
  let errorMessage: string | undefined;
  if (revalidate) {
    // isRequired auto-validation: empty value → error
    if (isRequired && isEmpty(currentValue)) {
      error = true;
      errorMessage = typeof configNode.isRequired === "string"
        ? configNode.isRequired
        : "required";
    }
    // Custom validate (runs even if isRequired already failed — custom message takes priority)
    if (typeof configNode.validate === "function") {
      const result = configNode.validate(currentValue, allValues);
      if (result) {
        error = Boolean(result);
        errorMessage = result;
      }
    }
  }

  return {
    value: currentValue,
    isVisible,
    isRequired,
    isDisabled,
    isReadOnly,
    label,
    placeholder,
    description,
    error,
    errorMessage,
  };
}

/**
 * Поверхностное сравнение двух FieldState.
 */
export function fieldStateChanged(a: FieldState, b: FieldState): boolean {
  return (
    a.value !== b.value ||
    a.isVisible !== b.isVisible ||
    a.isRequired !== b.isRequired ||
    a.isDisabled !== b.isDisabled ||
    a.isReadOnly !== b.isReadOnly ||
    a.label !== b.label ||
    a.placeholder !== b.placeholder ||
    a.description !== b.description ||
    a.error !== b.error ||
    a.errorMessage !== b.errorMessage ||
    a.submitting !== b.submitting ||
    a.dirty !== b.dirty ||
    a.revalidate !== b.revalidate
  );
}
