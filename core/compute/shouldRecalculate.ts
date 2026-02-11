/**
 * Логика определения необходимости пересчёта поля
 */

import type { FieldConfig } from "../types";

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
 * @param changedField - Поле, которое изменилось (null при init/reset)
 * @param fieldConfig - Конфиг поля (для чтения dependencies)
 * @returns true если нужно пересчитать fieldState
 */
export function shouldRecalculateField(
  fieldKey: string,
  changedField: string | null,
  fieldConfig?: FieldConfig<any, any>
): boolean {
  // При init/reset (changedField = null) пересчитываем всё
  if (changedField === null) return true;

  // Собственное изменение — всегда пересчитываем
  if (fieldKey === changedField) return true;

  if (!fieldConfig) return true;

  const { dependencies } = fieldConfig;

  // dependencies не указан → пересчёт при любом изменении
  if (dependencies === undefined) return true;

  // dependencies = [] → пересчёт только при изменении себя (уже проверили выше)
  if (dependencies.length === 0) return false;

  // Проверяем, есть ли changedField в списке зависимостей
  return (dependencies as string[]).includes(changedField);
}
