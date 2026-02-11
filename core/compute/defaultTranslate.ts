/**
 * Дефолтная функция перевода
 */

import type { TranslateFn } from "../types";

/**
 * Заглушка для translate — возвращает ключ как есть
 * Используется если translate не передан в опции формы
 */
export const defaultTranslate: TranslateFn = (key) => key;
