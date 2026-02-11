
import type { FormState, FormConfig, TranslateFn } from "../types";
import { computeAllFieldStates } from "../compute/computeFieldStates";
import { extractErrors } from "../compute/extractors";

import { type ComputeContext } from "../compute/types";

// ============================================================================
// Actions — чистые функции для изменения состояния
// ============================================================================

/**
 * Контекст для действий над формой
 * Содержит всё необходимое для вычисления нового состояния
 * 
 * config хранится в оригинальном вложенном виде.
 * Рекурсивный обход конфига выполняется в compute-функциях.
 */
export interface ActionContext<TValues extends Record<string, any>> {
  config: FormConfig<TValues>;
  translate: TranslateFn;
  locale: string;
}

/**
 * Создаёт начальное состояние формы
 *
 * @param defaults - значения по умолчанию
 * @param initial - начальные значения (перезаписывают defaults)
 * @param ctx - контекст с конфигом и translate
 * @returns начальное FormState
 *
 * @example
 * const initialState = createInitialState(
 *   { name: '', email: '' },
 *   { name: 'John' },
 *   { config, translate, locale: 'ru' }
 * );
 */
export function createInitialState<TValues extends Record<string, any>>(
  defaults: TValues,
  initial: Partial<TValues> | undefined,
  ctx: ActionContext<TValues>
): FormState<TValues> {
  // Мержим defaults и initial
  const values = { ...defaults, ...initial } as TValues;

  // Вычисляем fields для всех полей (рекурсивный обход конфига)
  const computeCtx: ComputeContext<TValues> = {
    values,
    config: ctx.config,
    translate: ctx.translate,
    locale: ctx.locale,
    showErrors: false,
  };

  const fields = computeAllFieldStates(computeCtx);
  const errors = extractErrors(fields);

  return {
    values,
    fields,
    errors,
    submitting: false,
    dirty: false,
    showErrors: false,
    initialValues: values,
    locale: ctx.locale,
  };
}