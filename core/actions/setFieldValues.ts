import type { FormState } from "../types";
import {
  computeAllFieldStates,
  extractErrors,
  type ComputeContext,
} from "../computeFields";
import { computeDirty } from "./computeDirty";
import type { ActionContext } from "./createInitialState";

/**
 * Устанавливает несколько значений сразу (batch update)
 *
 * @param state - текущее состояние
 * @param updates - объект с обновлениями { field1: value1, field2: value2 }
 * @param ctx - контекст
 * @returns новое состояние
 *
 * @example
 * const newState = setFieldValues(state, { name: 'John', age: 30 }, ctx);
 */
export function setFieldValues<TValues extends Record<string, any>>(
  state: FormState<TValues>,
  updates: Partial<TValues>,
  ctx: ActionContext<TValues>
): FormState<TValues> {
  // Применяем formatters и собираем новые values
  const newValues = { ...state.values };
  const changedKeys: Array<keyof TValues> = [];

  for (const key of Object.keys(updates) as Array<keyof TValues>) {
    let value = updates[key] as TValues[keyof TValues];
    const fieldConfig = ctx.config[key];

    // Применяем formatter
    if (fieldConfig?.formatter) {
      value = fieldConfig.formatter(value, newValues);
    }

    // Проверяем, изменилось ли значение
    if (!Object.is(state.values[key], value)) {
      newValues[key] = value;
      changedKeys.push(key);
    }
  }

  // Если ничего не изменилось, возвращаем тот же state
  if (changedKeys.length === 0) {
    return state;
  }

  // Пересчитываем fields
  // Для batch update пересчитываем все поля с undefined dependencies
  // или те, что зависят от любого из изменённых полей
  const computeCtx: ComputeContext<TValues> = {
    values: newValues as TValues,
    config: ctx.config,
    translate: ctx.translate,
    locale: ctx.locale,
    showErrors: state.showErrors,
  };

  // Простой подход: пересчитываем все поля
  // Оптимизация: можно сделать более умный пересчёт
  const newFields = computeAllFieldStates(computeCtx);
  const newErrors = extractErrors(newFields);
  const newDirty = computeDirty(newValues as TValues, state.initialValues);

  return {
    ...state,
    values: newValues as TValues,
    fields: newFields,
    errors: newErrors,
    dirty: newDirty,
  };
}
