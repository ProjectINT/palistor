import type { FormState } from "../types";

/**
 * Проверяет валидность формы (нет ошибок в видимых полях)
 *
 * @param state - состояние формы
 * @returns true если форма валидна
 */
export function isFormValid<TValues extends Record<string, any>>(
  state: FormState<TValues>
): boolean {
  // Проверяем только видимые поля
  for (const key of Object.keys(state.fields) as Array<keyof TValues>) {
    const field = state.fields[key];
    if (field.isVisible && field.error) {
      return false;
    }
  }
  return true;
}
