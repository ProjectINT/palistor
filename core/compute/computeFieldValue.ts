/**
 * Вычисление значений полей с поддержкой computed values
 */

import type { FormConfig } from "../types";

/**
 * Вычисляет value поля
 * Поддерживает computed values: ((values) => value)
 *
 * @example
 * // Простое значение
 * computeFieldValue('cardNumber', { cardNumber: '4111' }, config) // → '4111'
 *
 * // Computed value
 * // config.total.value = (v) => v.price * v.quantity
 * computeFieldValue('total', { price: 100, quantity: 2 }, config) // → 200
 */
export function computeFieldValue<TValues extends Record<string, any>, K extends keyof TValues>(
  key: K,
  values: TValues,
  config: FormConfig<TValues>
): TValues[K] {
  const fieldConfig = config[key];

  // Если в конфиге есть computed value (функция)
  if (fieldConfig && typeof fieldConfig.value === "function") {
    // Type assertion needed because TValue itself could be a Function type
    const computeFn = fieldConfig.value as (values: TValues) => TValues[K];
    return computeFn(values);
  }

  // Иначе берём из values
  return values[key];
}
