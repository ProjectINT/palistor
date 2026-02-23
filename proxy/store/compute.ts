// ─── Вычисленное состояние поля ──────────────────────────────────────────────

/**
 * Полное вычисленное состояние одного поля.
 *
 * Хранится в WeakMap<configNode, FieldState>. Все функции из конфига
 * (isVisible, isRequired, validate…) уже вызваны, результат — чистые значения.
 */
export interface FieldState {
  value: any;
  label?: string;
  placeholder?: string;
  description?: string;
  isRequired: boolean;
  isReadOnly: boolean;
  isDisabled: boolean;
  isVisible: boolean;
  error?: boolean;
  errorMessage?: string;
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
 * Пока без translate — если функция, вызываем с identity-функцией.
 */
export function resolveString(
  configValue: string | ((translate: any, settings?: any) => string) | undefined,
  values: Record<string, any> = {},
): string | undefined {
  if (configValue === undefined) return undefined;
  if (typeof configValue === "function") {
    // translate-функцию пока заменяем identity — вернёт ключ как есть
    return configValue((v: string) => v, values);
  }
  return configValue;
}

/**
 * Вычисляет полное состояние одного поля на основе конфига и текущих values.
 */
export function computeFieldState(
  configNode: Record<string, any>,
  currentValue: any,
  allValues: Record<string, any>,
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

  // Валидация
  let error: boolean | undefined;
  let errorMessage: string | undefined;
  if (typeof configNode.validate === "function") {
    const result = configNode.validate(currentValue, allValues);
    if (result) {
      error = Boolean(result);
      errorMessage = result;
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
    a.errorMessage !== b.errorMessage
  );
}
