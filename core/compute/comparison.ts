/**
 * Сравнение состояний полей
 */

import type { ComputedFieldState } from "../types";

/**
 * Сравнивает два ComputedFieldState на равенство
 *
 * Shallow comparison всех свойств. Если все свойства равны,
 * возвращаем true — можно переиспользовать старый объект.
 *
 * @example
 * isFieldStateEqual(
 *   { value: 'card', isVisible: true, ... },
 *   { value: 'card', isVisible: true, ... }
 * ) // → true
 *
 * isFieldStateEqual(
 *   { value: 'card', isVisible: true, ... },
 *   { value: 'card', isVisible: false, ... }
 * ) // → false
 */
export function isFieldStateEqual<TValue>(
  a: ComputedFieldState<TValue>,
  b: ComputedFieldState<TValue>
): boolean {
  return (
    Object.is(a.value, b.value) &&
    a.isVisible === b.isVisible &&
    a.isDisabled === b.isDisabled &&
    a.isReadOnly === b.isReadOnly &&
    a.isRequired === b.isRequired &&
    a.label === b.label &&
    a.placeholder === b.placeholder &&
    a.description === b.description &&
    a.error === b.error
  );
}
