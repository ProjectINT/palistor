import type { FormState } from "../types";

import { type ComputeContext } from "../compute/types";
import type { ActionContext } from "./createInitialState";
import { computeAllFieldStates } from "../compute/computeFieldStates";
import { extractErrors } from "../compute/extractors";

/**
 * Включает показ ошибок (обычно после первого submit)
 *
 * @param state - текущее состояние
 * @param ctx - контекст
 * @returns новое состояние с пересчитанными errors
 */
export function enableShowErrors<TValues extends Record<string, any>>(
  state: FormState<TValues>,
  ctx: ActionContext<TValues>
): FormState<TValues> {
  if (state.showErrors) {
    return state;
  }

  // Пересчитываем fields с showErrors=true
  const computeCtx: ComputeContext<TValues> = {
    values: state.values,
    config: ctx.config,
    translate: ctx.translate,
    locale: state.locale,
    showErrors: true,
  };

  const fields = computeAllFieldStates(computeCtx);
  const errors = extractErrors(fields);

  return {
    ...state,
    fields,
    errors,
    showErrors: true,
  };
}
