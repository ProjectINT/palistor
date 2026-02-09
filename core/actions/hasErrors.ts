import type { FormState } from "../types";

/**
 * Проверяет, есть ли ошибки в форме
 *
 * @param state - состояние формы
 * @returns true если есть хотя бы одна ошибка
 */
export function hasErrors<TValues extends Record<string, any>>(
  state: FormState<TValues>
): boolean {
  return Object.keys(state.errors).length > 0;
}
