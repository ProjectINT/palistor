/**
 * Утилита для преобразования вложенного конфига в плоскую структуру
 * 
 * Вложенный конфиг:
 * ```ts
 * {
 *   passport: {
 *     nested: true,
 *     number: { value: "" },
 *     issueDate: { value: "" }
 *   }
 * }
 * ```
 * 
 * Плоский конфиг:
 * ```ts
 * {
 *   passport: { nested: true },
 *   "passport.number": { value: "" },
 *   "passport.issueDate": { value: "" }
 * }
 * ```
 */

import type { FormConfig, FieldConfig } from "../core/types";
import { stringifyPath } from "./pathUtils";

/**
 * Список зарезервированных ключей в FieldConfig
 * Эти ключи не являются вложенными полями
 */
const RESERVED_FIELD_CONFIG_KEYS = new Set([
  "value",
  "label",
  "placeholder",
  "description",
  "validate",
  "formatter",
  "setter",
  "isRequired",
  "isReadOnly",
  "isDisabled",
  "isVisible",
  "dependencies",
  "nested",
  "componentProps",
  "types",
]);

/**
 * Проверяет, является ли ключ зарезервированным свойством FieldConfig
 */
function isReservedKey(key: string): boolean {
  return RESERVED_FIELD_CONFIG_KEYS.has(key);
}

/**
 * Извлекает только свойства FieldConfig (без вложенных полей)
 */
function extractFieldConfigProps<TValue, TValues>(
  config: FieldConfig<TValue, TValues>
): FieldConfig<TValue, TValues> {
  const result: Partial<FieldConfig<TValue, TValues>> = {};

  for (const key of Object.keys(config)) {
    if (isReservedKey(key)) {
      result[key as keyof FieldConfig<TValue, TValues>] = config[key as keyof FieldConfig<TValue, TValues>];
    }
  }

  return result as FieldConfig<TValue, TValues>;
}

/**
 * Преобразует вложенный конфиг в плоскую структуру
 * 
 * @param config - Исходный конфиг с вложенными полями
 * @param prefix - Префикс пути (для рекурсии)
 * @returns Плоский конфиг с ключами вида "parent.child"
 * 
 * @example
 * const nested = {
 *   passport: {
 *     nested: true,
 *     isVisible: true,
 *     number: { value: "", label: "Number" },
 *     issueDate: { value: "", label: "Issue Date" }
 *   }
 * };
 * 
 * const flat = flattenConfig(nested);
 * // Result:
 * // {
 * //   passport: { nested: true, isVisible: true },
 * //   "passport.number": { value: "", label: "Number" },
 * //   "passport.issueDate": { value: "", label: "Issue Date" }
 * // }
 */
export function flattenConfig<TValues extends Record<string, any>>(
  config: FormConfig<TValues>,
  prefix: string[] = []
): Record<string, FieldConfig<any, TValues>> {
  const result: Record<string, FieldConfig<any, TValues>> = {};

  for (const key of Object.keys(config)) {
    const fieldConfig = config[key];
    if (!fieldConfig) continue;

    const currentPath = [...prefix, key];
    const pathKey = stringifyPath(currentPath);

    // Проверяем, является ли это вложенным полем
    if (fieldConfig.nested === true) {
      // Добавляем родительское поле (только с зарезервированными свойствами)
      result[pathKey] = extractFieldConfigProps(fieldConfig);

      // Рекурсивно обрабатываем вложенные поля
      for (const nestedKey of Object.keys(fieldConfig)) {
        if (isReservedKey(nestedKey)) continue;

        const nestedFieldConfig = fieldConfig[nestedKey];
        if (typeof nestedFieldConfig === "object" && nestedFieldConfig !== null) {
          // Рекурсивный вызов для вложенных полей
          const nestedFlat = flattenConfig(
            { [nestedKey]: nestedFieldConfig } as FormConfig<TValues>,
            currentPath
          );
          Object.assign(result, nestedFlat);
        }
      }
    } else {
      // Обычное поле - добавляем как есть
      result[pathKey] = fieldConfig;
    }
  }

  return result;
}

/**
 * Создает начальные values из плоского конфига
 * 
 * @param flatConfig - Плоский конфиг
 * @returns Объект values с вложенной структурой
 * 
 * @example
 * const config = {
 *   name: { value: "John" },
 *   "passport.number": { value: "123" }
 * };
 * 
 * const values = createInitialValuesFromFlatConfig(config);
 * // { name: "John", passport: { number: "123" } }
 */
export function createInitialValuesFromFlatConfig<TValues extends Record<string, any>>(
  flatConfig: Record<string, FieldConfig<any, TValues>>
): TValues {
  const result: any = {};

  for (const key of Object.keys(flatConfig)) {
    const fieldConfig = flatConfig[key];
    if (!fieldConfig) continue;

    // Пропускаем родительские nested поля (они не имеют value)
    if (fieldConfig.nested === true && fieldConfig.value === undefined) {
      continue;
    }

    const path = key.split(".");
    let current = result;

    // Создаем вложенную структуру
    for (let i = 0; i < path.length - 1; i++) {
      const segment = path[i];
      if (!(segment in current)) {
        current[segment] = {};
      }
      current = current[segment];
    }

    // Устанавливаем значение
    const lastSegment = path[path.length - 1];
    const value = typeof fieldConfig.value === "function" 
      ? undefined // computed values вычисляются позже
      : fieldConfig.value;
    
    current[lastSegment] = value;
  }

  return result as TValues;
}
