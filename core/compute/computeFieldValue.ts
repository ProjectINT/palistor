/**
 * Вычисление значений полей с поддержкой computed values и вложенных путей
 */

import type { FieldConfig, FormConfig } from "../types";
import { getFieldByPath } from "../../utils/helpers";
import { parseFieldKey, getFieldConfigByPath } from "../../utils/pathUtils";

/**
 * Вычисляет value поля с поддержкой вложенных путей
 * Поддерживает computed values: ((values) => value)
 *
 * @param key - Путь к полю ("email" или "passport.number")
 * @param values - Текущие значения формы
 * @param config - Оригинальный вложенный конфиг
 * @param fieldConfig - Конфиг поля (опционально, если уже получен)
 *
 * @example
 * computeFieldValue('email', { email: 'a@b.c' }, config) // → 'a@b.c'
 * computeFieldValue('passport.number', { passport: { number: '123' } }, config) // → '123'
 * computeFieldValue('total', values, config) // → computed result if value is function
 */
export function computeFieldValue<TValues extends Record<string, any>>(
  key: string,
  values: TValues,
  config: FormConfig<TValues>,
  fieldConfig?: FieldConfig<any, TValues>
): any {
  const cfg = fieldConfig ?? getFieldConfigByPath(config, key);

  // Если в конфиге есть computed value (функция)
  if (cfg && typeof cfg.value === "function") {
    return cfg.value(values);
  }

  // Получаем значение из values по пути
  const path = parseFieldKey(key);
  return getFieldByPath(values, path);
}
