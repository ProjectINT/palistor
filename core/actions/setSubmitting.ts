import type { FormState } from "../types";

/**
 * Устанавливает флаг submitting
 */
export function setSubmitting<TValues extends Record<string, any>>(
  state: FormState<TValues>,
  submitting: boolean
): FormState<TValues> {
  if (state.submitting === submitting) {
    return state;
  }

  return {
    ...state,
    submitting,
  };
}
