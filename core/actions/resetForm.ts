import type { FormState } from "../types";
import { type ComputeContext } from "../compute/types";
import type { ActionContext } from "./createInitialState";
import { computeAllFieldStates } from "../compute/computeFieldStates";

/**
 * Сбрасывает форму к начальному состоянию
 *
 * @param state - текущее состояние
 * @param newInitial - новые начальные значения (опционально)
 * @param ctx - контекст
 * @returns новое состояние
 *
 * @example
 * // Полный сброс
 * const newState = resetForm(state, undefined, ctx);
 *
 * // Сброс с новыми значениями
 * const newState = resetForm(state, { name: 'New Name' }, ctx);
 */
export function resetForm<TValues extends Record<string, any>>(
  state: FormState<TValues>,
  newInitial: Partial<TValues> | undefined,
  defaults: TValues,
  ctx: ActionContext<TValues>
): FormState<TValues> {
  // Мержим defaults с newInitial
  const values = { ...defaults, ...newInitial } as TValues;

  // Пересчитываем все fields (это init/reset)
  const computeCtx: ComputeContext<TValues> = {
    values,
    config: ctx.config,
    translate: ctx.translate,
    locale: ctx.locale,
    showErrors: false,
  };

  const fields = computeAllFieldStates(computeCtx);

  return {
    values,
    fields,
    errors: {},
    submitting: false,
    dirty: false,
    showErrors: false,
    initialValues: values,
    locale: ctx.locale,
  };
}
