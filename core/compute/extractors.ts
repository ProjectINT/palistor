/**
 * Утилиты для извлечения данных из fieldStates
 */

import type { FieldStates } from "../types";

/**
 * Извлекает errors из fieldStates
 * Поддерживает вложенные ключи: errors["passport.number"]
 *
 * @example
 * const errors = extractErrors(fields);
 * // → { "cardNumber": "validation.required", "passport.number": "validation.required" }
 */
export function extractErrors<TValues extends Record<string, any>>(
  fields: FieldStates<TValues>
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const key of Object.keys(fields)) {
    const fieldState = fields[key];
    if (fieldState?.error) {
      errors[key] = fieldState.error;
    }
  }

  return errors;
}

/**
 * Извлекает values из fieldStates
 *
 * Полезно если values хранятся только в fields
 * (для нашей архитектуры не нужно, т.к. values дублируются)
 */
export function extractValues<TValues extends Record<string, any>>(
  fields: FieldStates<TValues>
): TValues {
  const values = {} as TValues;

  for (const key of Object.keys(fields)) {
    const fieldState = fields[key];
    if (fieldState) {
      (values as any)[key] = fieldState.value;
    }
  }

  return values;
}
