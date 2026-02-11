/**
 * Утилиты для вычисления отдельных свойств полей
 */

import type { TranslateFn } from "../types";

/**
 * Вычисляет boolean-свойство из конфига
 * Поддерживает: boolean | ((values) => boolean)
 *
 * @example
 * computeBooleanProp(true, values) // → true
 * computeBooleanProp((v) => v.amount > 0, values) // → зависит от values.amount
 */
export function computeBooleanProp<TValues>(
  prop: boolean | ((values: TValues) => boolean) | undefined,
  values: TValues,
  defaultValue: boolean
): boolean {
  if (prop === undefined) return defaultValue;

  if (typeof prop === "function") {
    const result = prop(values);

    if (typeof result !== "boolean") {
      throw new Error(`[Palistor] Expected boolean from compute function, got ${typeof result}`);
    }

    return result;
  };

  return prop;
}

/**
 * Вычисляет строковое свойство (label, placeholder, description)
 * Поддерживает: string | ((translate, settings?) => string)
 *
 * @example
 * computeStringProp('Имя', translate) // → 'Имя'
 * computeStringProp((t) => t('form.name'), translate) // → 'Name' (или перевод)
 */
export function computeStringProp<TValues>(
  prop: string | ((translate: TranslateFn, settings?: any) => string) | undefined,
  translate: TranslateFn,
  settings?: any
): string | undefined {
  if (prop === undefined) return undefined;
  if (typeof prop === "function") return prop(translate, settings);
  return prop;
}
