/**
 * Утилиты для работы с путями к вложенным полям
 * 
 * Поддерживает точечную нотацию для доступа к вложенным полям:
 * "passport.number" → ["passport", "number"]
 */

import type { FieldConfig, FormConfig } from "../core/types";

// ============================================================================
// Reserved keys — свойства FieldConfig, которые НЕ являются дочерними полями
// ============================================================================

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
 * (а не дочерним полем в nested конфиге)
 */
export function isReservedFieldConfigKey(key: string): boolean {
  return RESERVED_FIELD_CONFIG_KEYS.has(key);
}

// ============================================================================
// Config navigation — навигация по вложенному конфигу
// ============================================================================

/**
 * Получает конфиг поля по вложенному пути в оригинальном (не плоском) конфиге
 * 
 * @param config - Оригинальный вложенный конфиг формы
 * @param key - Путь к полю (может быть "passport.number")
 * @returns Конфиг поля или undefined
 * 
 * @example
 * const config = {
 *   passport: {
 *     nested: true,
 *     isVisible: () => true,
 *     number: { value: "", label: "Number" }
 *   }
 * };
 * 
 * getFieldConfigByPath(config, "passport") 
 * // → { nested: true, isVisible: ..., number: { value: "" } }
 * 
 * getFieldConfigByPath(config, "passport.number") 
 * // → { value: "", label: "Number" }
 */
export function getFieldConfigByPath<TValues extends Record<string, any>>(
  config: FormConfig<TValues>,
  key: string
): FieldConfig<any, TValues> | undefined {
  const parts = parseFieldKey(key);
  let current: any = config;

  for (const part of parts) {
    if (!current || typeof current !== "object") return undefined;
    current = current[part];
  }

  return current as FieldConfig<any, TValues> | undefined;
}

/**
 * Парсит ключ поля в массив пути
 * 
 * @param key - Ключ поля (строка с точками или массив)
 * @returns Массив сегментов пути
 * 
 * @example
 * parseFieldKey("passport.number") // → ["passport", "number"]
 * parseFieldKey("email") // → ["email"]
 * parseFieldKey(["address", "city"]) // → ["address", "city"]
 */
export function parseFieldKey(key: string | readonly string[] | string[]): string[] {
  if (Array.isArray(key)) {
    return [...key];
  }
  
  if (typeof key === "string") {
    return key.split(".");
  }
  
  throw new Error(`[pathUtils] Invalid key type: ${typeof key}`);
}

/**
 * Преобразует массив пути в строковый ключ
 * 
 * @param path - Массив сегментов пути
 * @returns Строковый ключ с точками
 * 
 * @example
 * stringifyPath(["passport", "number"]) // → "passport.number"
 * stringifyPath(["email"]) // → "email"
 */
export function stringifyPath(path: string[]): string {
  return path.join(".");
}

/**
 * Проверяет, является ли ключ вложенным (содержит точку)
 * 
 * @param key - Ключ поля
 * @returns true, если ключ вложенный
 * 
 * @example
 * isNestedKey("passport.number") // → true
 * isNestedKey("email") // → false
 */
export function isNestedKey(key: string): boolean {
  return typeof key === "string" && key.includes(".");
}

/**
 * Получает корневой ключ из пути
 * 
 * @param key - Ключ поля
 * @returns Корневой ключ
 * 
 * @example
 * getRootKey("passport.number") // → "passport"
 * getRootKey("email") // → "email"
 */
export function getRootKey(key: string): string {
  return parseFieldKey(key)[0];
}

/**
 * Получает оставшийся путь после корневого ключа
 * 
 * @param key - Ключ поля
 * @returns Оставшийся путь или undefined
 * 
 * @example
 * getNestedPath("passport.number.value") // → "number.value"
 * getNestedPath("email") // → undefined
 */
export function getNestedPath(key: string): string | undefined {
  const path = parseFieldKey(key);
  if (path.length <= 1) {
    return undefined;
  }
  return stringifyPath(path.slice(1));
}
