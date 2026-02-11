/**
 * Логика определения необходимости пересчёта поля
 */

import type { FormConfig } from "../types";

/**
 * Определяет, нужно ли пересчитывать поле при изменении другого поля
 *
 * ПРАВИЛА:
 * - Если changedField === fieldKey → всегда true (собственное изменение)
 * - Если dependencies === undefined → true (пересчёт при любом изменении)
 * - Если dependencies === [] → false (пересчёт только при init/reset)
 * - Если changedField в dependencies → true
 *
 * @param fieldKey - Поле, которое проверяем
 * @param changedField - Поле, которое изменилось (или null при init/reset)
 * @param config - Конфигурация формы
 * @returns true если нужно пересчитать fieldState
 *
 * @example
 * // dependencies не указан → пересчёт при любом изменении
 * shouldRecalculateField('cardNumber', 'amount', config) // → true
 *
 * // dependencies: ['paymentType']
 * shouldRecalculateField('cardNumber', 'paymentType', config) // → true
 * shouldRecalculateField('cardNumber', 'amount', config) // → false
 *
 * // dependencies: [] → только при изменении себя
 * shouldRecalculateField('comment', 'paymentType', config) // → false
 * shouldRecalculateField('comment', 'comment', config) // → true
 *
 * // changedField = null → init/reset, пересчитываем все
 * shouldRecalculateField('cardNumber', null, config) // → true
 */
export function shouldRecalculateField<TValues extends Record<string, any>>(
  fieldKey: keyof TValues,
  changedField: keyof TValues | null,
  config: FormConfig<TValues>
): boolean {
  // При init/reset (changedField = null) пересчитываем всё
  if (changedField === null) return true;

  // Собственное изменение — всегда пересчитываем
  if (fieldKey === changedField) return true;

  const fieldConfig = config[fieldKey];
  if (!fieldConfig) return true;

  const { dependencies } = fieldConfig;

  // dependencies не указан → пересчёт при любом изменении
  if (dependencies === undefined) return true;

  // dependencies = [] → пересчёт только при изменении себя (уже проверили выше)
  if (dependencies.length === 0) return false;

  // Проверяем, есть ли changedField в списке зависимостей
  return dependencies.includes(changedField);
}
