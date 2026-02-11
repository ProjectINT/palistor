/**
 * Вычисление состояний нескольких полей
 */

import type { FieldStates } from "../types";
import type { ComputeContext } from "./types";
import { computeFieldState } from "./computeFieldState";
import { shouldRecalculateField } from "./shouldRecalculate";
import { isFieldStateEqual } from "./comparison";

/**
 * Вычисляет fieldStates для всех полей
 *
 * Используется при инициализации формы и полном пересчёте (reset, setLocale)
 *
 * @param ctx - Контекст вычисления
 * @returns Словарь вычисленных состояний всех полей
 *
 * @example
 * const fields = computeAllFieldStates({
 *   values: initialValues,
 *   config: formConfig,
 *   translate: t,
 *   locale: 'ru',
 *   showErrors: false,
 * });
 */
export function computeAllFieldStates<TValues extends Record<string, any>>(
  ctx: ComputeContext<TValues>
): FieldStates<TValues> {
  const { values, config } = ctx;
  const fields = {} as FieldStates<TValues>;

  // Вычисляем состояние для каждого поля из values
  for (const key of Object.keys(values) as Array<keyof TValues>) {
    fields[key] = computeFieldState(key, ctx);
  }

  return fields;
}

/**
 * Пересчитывает fieldStates после изменения одного поля
 *
 * Оптимизированная версия — пересчитывает только зависимые поля
 *
 * @param prevFields - Предыдущие fieldStates
 * @param changedField - Поле, которое изменилось
 * @param ctx - Контекст вычисления (с новыми values)
 * @returns Новые fieldStates (с переиспользованием неизменившихся объектов)
 *
 * @example
 * // Пользователь изменил paymentType
 * const newFields = recomputeFieldStates(
 *   prevFields,
 *   'paymentType',
 *   { values: newValues, config, translate, locale, showErrors }
 * );
 * // Пересчитаются только поля с dependencies: undefined или dependencies включает 'paymentType'
 */
export function recomputeFieldStates<TValues extends Record<string, any>>(
  prevFields: FieldStates<TValues>,
  changedField: keyof TValues,
  ctx: ComputeContext<TValues>
): FieldStates<TValues> {
  const { values, config } = ctx;
  const newFields = {} as FieldStates<TValues>;
  let hasChanges = false;

  for (const key of Object.keys(values) as Array<keyof TValues>) {
    // Проверяем, нужно ли пересчитывать это поле
    if (shouldRecalculateField(key, changedField, config)) {
      const newState = computeFieldState(key, ctx);

      // Проверяем, изменилось ли состояние
      if (isFieldStateEqual(prevFields[key], newState)) {
        // Состояние не изменилось — переиспользуем старый объект
        newFields[key] = prevFields[key];
      } else {
        // Состояние изменилось — используем новый объект
        newFields[key] = newState;
        hasChanges = true;
      }
    } else {
      // Поле не нужно пересчитывать — переиспользуем старый объект
      newFields[key] = prevFields[key];
    }
  }

  // Если ничего не изменилось, возвращаем старый объект fields
  // Это важно для React — Object.is(prevFields, newFields) === true
  return hasChanges ? newFields : prevFields;
}
