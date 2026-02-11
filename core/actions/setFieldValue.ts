import type { FormState } from "../types";
import { recomputeFieldStates } from "../compute/computeFieldStates";
import { extractErrors } from "../compute/extractors";
import { computeDirty } from "./computeDirty";
import { createComputeContext } from "./createComputeContext";
import type { ActionContext } from "./createInitialState";

/**
 * Устанавливает значение одного поля
 *
 * @param state - текущее состояние
 * @param key - имя поля
 * @param value - новое значение
 * @param ctx - контекст
 * @returns новое состояние (или то же, если значение не изменилось)
 *
 * @example
 * const newState = setFieldValue(state, 'email', 'test@example.com', ctx);
 */
export function setFieldValue<
  TValues extends Record<string, any>,
  K extends keyof TValues
>(
  state: FormState<TValues>,
  key: K,
  value: TValues[K],
  ctx: ActionContext<TValues>
): FormState<TValues> {
  const fieldConfig = ctx.config[key];

  // Применяем formatter если есть
  let processedValue = value;
  if (fieldConfig?.formatter) {
    processedValue = fieldConfig.formatter(value, state.values);
  }

  // Проверяем, изменилось ли значение
  if (Object.is(state.values[key], processedValue)) {
    return state;
  }

  // Создаём новые values
  const newValues = { ...state.values, [key]: processedValue } as TValues;

  // Пересчитываем fields для зависимых полей
  const computeCtx = createComputeContext(
    { ...state, values: newValues },
    ctx
  );

  const newFields = recomputeFieldStates(state.fields, key, computeCtx);

  // Извлекаем errors из fields
  const newErrors = extractErrors(newFields);

  // Вычисляем dirty
  const newDirty = computeDirty(newValues, state.initialValues);

  return {
    ...state,
    values: newValues,
    fields: newFields,
    errors: newErrors,
    dirty: newDirty,
  };
}
