import type { FormState } from "../types";
import { recomputeFieldStates } from "../compute/computeFieldStates";
import { extractErrors } from "../compute/extractors";
import { computeDirty } from "./computeDirty";
import { createComputeContext } from "./createComputeContext";
import type { ActionContext } from "./createInitialState";
import { setFieldByPath } from "../../utils/helpers";
import { parseFieldKey, getFieldConfigByPath } from "../../utils/pathUtils";

/**
 * Устанавливает значение одного поля (поддерживает вложенные пути)
 *
 * @param state - текущее состояние
 * @param key - имя поля или путь ("passport.number")
 * @param value - новое значение
 * @param ctx - контекст
 * @returns новое состояние (или то же, если значение не изменилось)
 */
export function setFieldValue<TValues extends Record<string, any>>(
  state: FormState<TValues>,
  key: string,
  value: any,
  ctx: ActionContext<TValues>
): FormState<TValues> {
  const fieldConfig = getFieldConfigByPath(ctx.config, key);

  // Применяем formatter если есть
  let processedValue = value;
  if (fieldConfig?.formatter) {
    processedValue = fieldConfig.formatter(value, state.values);
  }

  // Получаем текущее значение по пути для сравнения
  const path = parseFieldKey(key);
  const currentValue = path.reduce((obj: any, k) => obj?.[k], state.values);

  // Проверяем, изменилось ли значение
  if (Object.is(currentValue, processedValue)) {
    return state;
  }

  // Создаём новые values с использованием setFieldByPath (иммутабельно)
  const newValues = setFieldByPath(state.values, path, processedValue) as TValues;

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
