/**
 * Вычисление состояний нескольких полей
 * 
 * Рекурсивно обходит вложенный конфиг, генерирует плоский словарь
 * состояний с ключами вида "passport", "passport.number" и т.д.
 */

import type { FieldStates } from "../types";
import type { ComputeContext } from "./types";
import { computeFieldState } from "./computeFieldState";
import { shouldRecalculateField } from "./shouldRecalculate";
import { isFieldStateEqual } from "./comparison";
import { isReservedFieldConfigKey, getFieldConfigByPath } from "../../utils/pathUtils";

/**
 * Рекурсивно собирает fieldStates из вложенного конфига
 * 
 * @param configLevel - Текущий уровень конфига
 * @param prefix - Префикс пути (для формирования "passport.number")
 * @param fields - Словарь для накопления результатов
 * @param ctx - Контекст вычисления
 * @param insideNested - Находимся ли мы внутри nested поля (нужно пропускать reserved keys)
 */
function collectFieldStates<TValues extends Record<string, any>>(
  configLevel: Record<string, any>,
  prefix: string,
  fields: Record<string, any>,
  ctx: ComputeContext<TValues>,
  insideNested: boolean
): void {
  for (const key of Object.keys(configLevel)) {
    // Внутри nested конфига пропускаем зарезервированные свойства FieldConfig
    if (insideNested && isReservedFieldConfigKey(key)) continue;

    const fieldConfig = configLevel[key];
    if (!fieldConfig || typeof fieldConfig !== "object") continue;

    const fullKey = prefix ? `${prefix}.${key}` : key;

    // Вычисляем состояние этого поля (включая nested-родителя)
    fields[fullKey] = computeFieldState(fullKey, ctx, fieldConfig);

    // Если поле nested — рекурсивно обрабатываем дочерние поля
    if (fieldConfig.nested) {
      collectFieldStates(fieldConfig, fullKey, fields, ctx, true);
    }
  }
}

/**
 * Вычисляет fieldStates для всех полей из конфига
 *
 * Рекурсивно обходит вложенный конфиг:
 * - passport: { nested: true, number: {...} }
 * - Генерирует: { "passport": {...}, "passport.number": {...} }
 *
 * @param ctx - Контекст вычисления
 * @returns Плоский словарь вычисленных состояний всех полей
 *
 * @example
 * const fields = computeAllFieldStates({
 *   values: { passport: { number: "123" } },
 *   config: { passport: { nested: true, number: { value: "" } } },
 *   translate: t,
 *   locale: 'ru',
 *   showErrors: false,
 * });
 * // → { "passport": { isVisible: true, ... }, "passport.number": { value: "123", ... } }
 */
export function computeAllFieldStates<TValues extends Record<string, any>>(
  ctx: ComputeContext<TValues>
): FieldStates<TValues> {
  const fields: Record<string, any> = {};

  collectFieldStates(ctx.config as Record<string, any>, "", fields, ctx, false);

  return fields as FieldStates<TValues>;
}

/**
 * Пересчитывает fieldStates после изменения одного поля
 *
 * Оптимизированная версия — пересчитывает только зависимые поля.
 * Итерирует по существующим ключам в prevFields (плоские ключи).
 * Для каждого ключа находит конфиг через getFieldConfigByPath.
 *
 * @param prevFields - Предыдущие fieldStates
 * @param changedField - Поле, которое изменилось (может быть "passport.number")
 * @param ctx - Контекст вычисления (с новыми values)
 * @returns Новые fieldStates (с переиспользованием неизменившихся объектов)
 */
export function recomputeFieldStates<TValues extends Record<string, any>>(
  prevFields: FieldStates<TValues>,
  changedField: string,
  ctx: ComputeContext<TValues>
): FieldStates<TValues> {
  const newFields: Record<string, any> = {};
  let hasChanges = false;

  for (const key of Object.keys(prevFields)) {
    const fieldConfig = getFieldConfigByPath(ctx.config, key);

    // Проверяем, нужно ли пересчитывать это поле
    if (shouldRecalculateField(key, changedField, fieldConfig)) {
      const newState = computeFieldState(key, ctx, fieldConfig);

      // Проверяем, изменилось ли состояние
      if (isFieldStateEqual(prevFields[key], newState)) {
        newFields[key] = prevFields[key];
      } else {
        newFields[key] = newState;
        hasChanges = true;
      }
    } else {
      newFields[key] = prevFields[key];
    }
  }

  // Если ничего не изменилось, возвращаем старый объект fields
  return hasChanges ? newFields : prevFields;
}
