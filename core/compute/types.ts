/**
 * Типы для системы вычисления состояния полей
 */

import type { FormConfig, TranslateFn } from "../types";

/**
 * Контекст вычисления — всё необходимое для computeFieldState
 */
export interface ComputeContext<TValues extends Record<string, any>> {
  /** Текущие значения всех полей */
  values: TValues;
  /** Конфигурация формы */
  config: FormConfig<TValues>;
  /** Функция перевода (i18n) */
  translate: TranslateFn;
  /** Текущая локаль */
  locale: string;
  /** Показывать ли ошибки */
  showErrors: boolean;
}
