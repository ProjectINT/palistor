/**
 * Palistor - Чистые функции для работы с FormState
 *
 * Все функции в этом модуле:
 * - Чистые (pure) — не имеют побочных эффектов
 * - Принимают текущее состояние и возвращают новое
 * - Легко тестируются изолированно
 *
 * Архитектура:
 * ```
 * UI Event → Action Function → New State → Store.setState()
 * ```
 */

import type {
  FormState,
  FormConfig,
  FieldConfig,
  TranslateFn,
} from "./types";
import {
  computeFieldState,
  recomputeFieldStates,
  computeAllFieldStates,
  extractErrors,
  defaultTranslate,
  type ComputeContext,
} from "./computeFields";

// ============================================================================
// Типы
// ============================================================================

/**
 * Контекст для действий над формой
 * Содержит всё необходимое для вычисления нового состояния
 */
export interface ActionContext<TValues extends Record<string, any>> {
  config: FormConfig<TValues>;
  translate: TranslateFn;
  locale: string;
}

// ============================================================================
// Утилиты
// ============================================================================

/**
 * Создаёт ComputeContext из FormState и ActionContext
 */
function createComputeContext<TValues extends Record<string, any>>(
  state: FormState<TValues>,
  ctx: ActionContext<TValues>
): ComputeContext<TValues> {
  return {
    values: state.values,
    config: ctx.config,
    translate: ctx.translate,
    locale: ctx.locale,
    showErrors: state.showErrors,
  };
}

/**
 * Проверяет, изменилась ли форма относительно initialValues
 * Использует глубокое сравнение через JSON (простое и надёжное)
 */
export function computeDirty<TValues extends Record<string, any>>(
  values: TValues,
  initialValues: TValues
): boolean {
  return JSON.stringify(values) !== JSON.stringify(initialValues);
}

// ============================================================================
// Actions — чистые функции для изменения состояния
// ============================================================================

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

  // Вычисляем fields для всех полей
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

// ============================================================================
// Валидация
// ============================================================================

/**
 * Проверяет, есть ли ошибки в форме
 *
 * @param state - состояние формы
 * @returns true если есть хотя бы одна ошибка
 */
export function hasErrors<TValues extends Record<string, any>>(
  state: FormState<TValues>
): boolean {
  return Object.keys(state.errors).length > 0;
}

/**
 * Проверяет валидность формы (нет ошибок в видимых полях)
 *
 * @param state - состояние формы
 * @returns true если форма валидна
 */
export function isFormValid<TValues extends Record<string, any>>(
  state: FormState<TValues>
): boolean {
  // Проверяем только видимые поля
  for (const key of Object.keys(state.fields) as Array<keyof TValues>) {
    const field = state.fields[key];
    if (field.isVisible && field.error) {
      return false;
    }
  }
  return true;
}

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
