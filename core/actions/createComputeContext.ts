/**
 * Создаёт ComputeContext из FormState и ActionContext
 */

import type { ActionContext } from "./createInitialState";
import type { ComputeContext } from "../compute/types";
import type { FormState } from "../types";

export const createComputeContext = <TValues extends Record<string, any>>(
  state: FormState<TValues>,
  ctx: ActionContext<TValues>
): ComputeContext<TValues> => {
  return {
    values: state.values,
    config: ctx.config,
    translate: ctx.translate,
    locale: ctx.locale,
    showErrors: state.showErrors,
  };
}