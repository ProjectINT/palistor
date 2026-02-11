/**
 * Вычисление состояния одного поля с поддержкой вложенных путей
 */

import type { FieldConfig, ComputedFieldState } from "../types";
import type { ComputeContext } from "./types";
import { computeBooleanProp, computeStringProp } from "./computeProperties";
import { computeFieldValue } from "./computeFieldValue";
import { getFieldConfigByPath } from "../../utils/pathUtils";

/**
 * Вычисляет полное состояние одного поля
 *
 * Превращает FieldConfig (с функциями) в ComputedFieldState (с значениями)
 * Поддерживает вложенные пути: "passport.number"
 *
 * @param key - Имя поля или путь к полю
 * @param ctx - Контекст вычисления
 * @param fieldConfig - Конфиг поля (опционально, если уже получен)
 * @returns Вычисленное состояние поля
 *
 * @example
 * const passportState = computeFieldState('passport', ctx);
 * // → { value: { number: '123', ... }, isVisible: true, ... }
 * 
 * const numberState = computeFieldState('passport.number', ctx);
 * // → { value: '123', isVisible: true, ... }
 */
export function computeFieldState<TValues extends Record<string, any>>(
  key: string,
  ctx: ComputeContext<TValues>,
  fieldConfig?: FieldConfig<any, TValues>
): ComputedFieldState<any> {
  const { values, config, translate, showErrors } = ctx;
  const cfg = fieldConfig ?? getFieldConfigByPath(config, key) ?? ({} as FieldConfig<any, TValues>);

  // Вычисляем value (поддержка computed values и вложенных путей)
  const value = computeFieldValue(key, values, config, cfg);

  // Вычисляем boolean свойства
  const isVisible = computeBooleanProp(cfg.isVisible, values, true);
  const isDisabled = computeBooleanProp(cfg.isDisabled, values, false);
  const isReadOnly = computeBooleanProp(cfg.isReadOnly, values, false);
  const isRequired = computeBooleanProp(cfg.isRequired, values, false);

  // Вычисляем строковые свойства
  const label = computeStringProp(cfg.label, translate);
  const placeholder = computeStringProp(cfg.placeholder, translate);
  const description = computeStringProp(cfg.description, translate);

  // Вычисляем ошибку (только если showErrors=true)
  let error: string | undefined;
  if (showErrors && cfg.validate) {
    error = cfg.validate(value, values);
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
