import type { FormState } from "../types";

import { type ComputeContext } from "../compute/types";
import type { ActionContext } from "./createInitialState";
import { computeAllFieldStates } from "../compute/computeFieldStates";
import { extractErrors } from "../compute/extractors";

/**
 * Меняет локаль формы — пересчитывает все label/placeholder/description
 *
 * @param state - текущее состояние
 * @param newLocale - новая локаль
 * @param ctx - контекст (с новым translate!)
 * @returns новое состояние
 *
 * @example
 * const newState = setLocale(state, 'en', { ...ctx, locale: 'en' });
 */
export function setFormLocale<TValues extends Record<string, any>>(
  state: FormState<TValues>,
  newLocale: string,
  ctx: ActionContext<TValues>
): FormState<TValues> {
  // Если локаль не изменилась, ничего не делаем
  if (state.locale === newLocale) {
    return state;
  }

  // Пересчитываем все fields с новой локалью
  const computeCtx: ComputeContext<TValues> = {
    values: state.values,
    config: ctx.config,
    translate: ctx.translate,
    locale: newLocale,
    showErrors: state.showErrors,
  };

  const fields = computeAllFieldStates(computeCtx);
  const errors = extractErrors(fields);

  return {
    ...state,
    fields,
    errors,
    locale: newLocale,
  };
}
