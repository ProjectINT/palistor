/**
 * Вычисление состояния одного поля
 */

import type { FieldConfig, ComputedFieldState } from "../types";
import type { ComputeContext } from "./types";
import { computeBooleanProp, computeStringProp } from "./computeProperties";
import { computeFieldValue } from "./computeFieldValue";

/**
 * Вычисляет полное состояние одного поля
 *
 * Превращает FieldConfig (с функциями) в ComputedFieldState (с значениями)
 *
 * @param key - Имя поля
 * @param ctx - Контекст вычисления
 * @returns Вычисленное состояние поля
 *
 * @example
 * const cardNumberState = computeFieldState('cardNumber', {
 *   values: { paymentType: 'card', cardNumber: '4111' },
 *   config: formConfig,
 *   translate: t,
 *   locale: 'ru',
 *   showErrors: false,
 * });
 * // → { value: '4111', isVisible: true, isRequired: true, label: 'Номер карты', ... }
 */
export function computeFieldState<
  TValues extends Record<string, any>,
  K extends keyof TValues
>(
  key: K,
  ctx: ComputeContext<TValues>
): ComputedFieldState<TValues[K]> {
  const { values, config, translate, showErrors } = ctx;
  const fieldConfig = config[key] || ({} as FieldConfig<TValues[K], TValues>);

  // Вычисляем value (поддержка computed values)
  const value = computeFieldValue(key, values, config);

  // Вычисляем boolean свойства
  const isVisible = computeBooleanProp(fieldConfig.isVisible, values, true);
  const isDisabled = computeBooleanProp(fieldConfig.isDisabled, values, false);
  const isReadOnly = computeBooleanProp(fieldConfig.isReadOnly, values, false);
  const isRequired = computeBooleanProp(fieldConfig.isRequired, values, false);

  // Вычисляем строковые свойства
  const label = computeStringProp(fieldConfig.label, translate);
  const placeholder = computeStringProp(fieldConfig.placeholder, translate);
  const description = computeStringProp(fieldConfig.description, translate);

  // Вычисляем ошибку (только если showErrors=true)
  let error: string | undefined;
  if (showErrors && fieldConfig.validate) {
    error = fieldConfig.validate(value, values);
  }

  return {
    value,
    isVisible,
    isDisabled,
    isReadOnly,
    isRequired,
    label,
    placeholder,
    description,
    error,
  };
}
