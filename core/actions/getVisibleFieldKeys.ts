import type { FormState } from "../types";

/**
 * Получает список видимых полей
 */
export function getVisibleFieldKeys<TValues extends Record<string, any>>(
  state: FormState<TValues>
): Array<keyof TValues & string> {
  const visible: Array<keyof TValues & string> = [];

  for (const key of Object.keys(state.fields) as Array<keyof TValues & string>) {
    if (state.fields[key].isVisible) {
      visible.push(key);
    }
  }

  return visible;
}
