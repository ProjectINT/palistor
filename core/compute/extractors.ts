/**
 * Утилиты для извлечения данных из fieldStates
 */

import type { FieldStates } from "../types";

/**
 * Извлекает errors из fieldStates
 *
 * Удобно для обратной совместимости — FormState.errors
 *
 * @example
 * const errors = extractErrors(fields);
 * // → { cardNumber: 'validation.required', amount: undefined }
 */
export function extractErrors<TValues extends Record<string, any>>(
  fields: FieldStates<TValues>
): Partial<Record<keyof TValues, string>> {
  const errors: Partial<Record<keyof TValues, string>> = {};

  for (const key of Object.keys(fields) as Array<keyof TValues>) {
    if (fields[key].error) {
      errors[key] = fields[key].error;
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

  for (const key of Object.keys(fields) as Array<keyof TValues>) {
    values[key] = fields[key].value;
  }

  return values;
}
