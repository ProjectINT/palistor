/**
 * Palistor - Система вычисления состояния полей (ComputedFieldState)
 *
 * Этот модуль отвечает за:
 * 1. Вычисление fieldState из FieldConfig + values
 * 2. Оптимизацию через массив dependencies
 * 3. Сравнение состояний для минимизации ре-рендеров
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * АРХИТЕКТУРА
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * FieldConfig (конфигурация)     ComputedFieldState (вычисленное)
 * ┌─────────────────────────┐    ┌────────────────────────────────┐
 * │ isVisible: (v) => ...   │ →  │ isVisible: true                │
 * │ isRequired: true        │ →  │ isRequired: true               │
 * │ label: (t) => t('key')  │ →  │ label: 'Номер карты'           │
 * │ dependencies: ['type']  │    │                                │
 * └─────────────────────────┘    └────────────────────────────────┘
 *
 * ПОТОК ВЫЧИСЛЕНИЯ:
 * ```
 * setValue('paymentType', 'bank')
 *    │
 *    ▼
 * shouldRecalculateField('cardNumber', 'paymentType', config)
 *    │ → config.cardNumber.dependencies = ['paymentType']
 *    │ → 'paymentType' в списке → true
 *    ▼
 * computeFieldState('cardNumber', values, config, translate)
 *    │ → isVisible = config.isVisible(values) → false
 *    │ → isRequired = config.isRequired(values) → false
 *    │ → label = config.label(translate) → 'Card Number'
 *    ▼
 * Новый ComputedFieldState для cardNumber
 * ```
 */

import type {
  FieldConfig,
  FormConfig,
  ComputedFieldState,
  FieldStates,
  TranslateFn,
} from "./types";

// ============================================================================
// Типы для внутреннего использования
// ============================================================================

/**
 * Контекст вычисления — всё необходимое для computeFieldState
 */
export interface ComputeContext<TValues extends Record<string, any>> {
  /** Текущие значения всех полей */
  values: TValues;
  /** Конфигурация формы */
  config: FormConfig<TValues>;
  /** Функция перевода (i18n) */
  translate: TranslateFn;
  /** Текущая локаль */
  locale: string;
  /** Показывать ли ошибки */
  showErrors: boolean;
}

// ============================================================================
// Утилиты вычисления отдельных свойств
// ============================================================================

/**
 * Вычисляет boolean-свойство из конфига
 * Поддерживает: boolean | ((values) => boolean)
 *
 * @example
 * computeBooleanProp(true, values) // → true
 * computeBooleanProp((v) => v.amount > 0, values) // → зависит от values.amount
 */
function computeBooleanProp<TValues>(
  prop: boolean | ((values: TValues) => boolean) | undefined,
  values: TValues,
  defaultValue: boolean
): boolean {
  if (prop === undefined) return defaultValue;
  if (typeof prop === "function") return prop(values);
  return prop;
}

/**
 * Вычисляет isRequired из конфига
 * Поддерживает: boolean | string | ((values) => boolean | string)
 *
 * @returns boolean (для ComputedFieldState.isRequired)
 *
 * @example
 * computeIsRequired(true, values) // → true
 * computeIsRequired('Обязательное поле', values) // → true (string = required + message)
 * computeIsRequired((v) => v.type === 'paid', values) // → зависит от values.type
 */
function computeIsRequired<TValues>(
  prop: boolean | string | ((values: TValues) => boolean | string) | undefined,
  values: TValues
): boolean {
  if (prop === undefined) return false;
  if (typeof prop === "function") {
    const result = prop(values);
    return typeof result === "string" ? true : result;
  }
  if (typeof prop === "string") return true;
  return prop;
}

/**
 * Вычисляет строковое свойство (label, placeholder, description)
 * Поддерживает: string | ((translate, settings?) => string)
 *
 * @example
 * computeStringProp('Имя', translate) // → 'Имя'
 * computeStringProp((t) => t('form.name'), translate) // → 'Name' (или перевод)
 */
function computeStringProp<TValues>(
  prop: string | ((translate: TranslateFn, settings?: any) => string) | undefined,
  translate: TranslateFn,
  settings?: any
): string | undefined {
  if (prop === undefined) return undefined;
  if (typeof prop === "function") return prop(translate, settings);
  return prop;
}

/**
 * Вычисляет value поля
 * Поддерживает computed values: ((values) => value)
 *
 * @example
 * // Простое значение
 * computeFieldValue('cardNumber', { cardNumber: '4111' }, config) // → '4111'
 *
 * // Computed value
 * // config.total.value = (v) => v.price * v.quantity
 * computeFieldValue('total', { price: 100, quantity: 2 }, config) // → 200
 */
function computeFieldValue<TValues extends Record<string, any>, K extends keyof TValues>(
  key: K,
  values: TValues,
  config: FormConfig<TValues>
): TValues[K] {
  const fieldConfig = config[key];

  // Если в конфиге есть computed value
  if (fieldConfig && typeof fieldConfig.value === "function") {
    return fieldConfig.value(values);
  }

  // Иначе берём из values
  return values[key];
}

// ============================================================================
// Основные функции
// ============================================================================

/**
 * Вычисляет полное состояние одного поля
 *
 * Превращает FieldConfig (с функциями) в ComputedFieldState (с значениями)
 *
 * @param key - Имя поля
 * @param ctx - Контекст вычисления
 * @returns Вычисленное состояние поля
 *
 * @example
 * const cardNumberState = computeFieldState('cardNumber', {
 *   values: { paymentType: 'card', cardNumber: '4111' },
 *   config: formConfig,
 *   translate: t,
 *   locale: 'ru',
 *   showErrors: false,
 * });
 * // → { value: '4111', isVisible: true, isRequired: true, label: 'Номер карты', ... }
 */
export function computeFieldState<
  TValues extends Record<string, any>,
  K extends keyof TValues
>(
  key: K,
  ctx: ComputeContext<TValues>
): ComputedFieldState<TValues[K]> {
  const { values, config, translate, showErrors } = ctx;
  const fieldConfig = config[key] || ({} as FieldConfig<TValues[K], TValues>);

  // Вычисляем value (поддержка computed values)
  const value = computeFieldValue(key, values, config);

  // Вычисляем boolean свойства
  const isVisible = computeBooleanProp(fieldConfig.isVisible, values, true);
  const isDisabled = computeBooleanProp(fieldConfig.isDisabled, values, false);
  const isReadOnly = computeBooleanProp(fieldConfig.isReadOnly, values, false);
  const isRequired = computeIsRequired(fieldConfig.isRequired, values);

  // Вычисляем строковые свойства
  const label = computeStringProp(fieldConfig.label, translate);
  const placeholder = computeStringProp(fieldConfig.placeholder, translate);
  const description = computeStringProp(fieldConfig.description, translate);

  // Вычисляем ошибку (только если showErrors=true)
  let error: string | undefined;
  if (showErrors && fieldConfig.validate) {
    error = fieldConfig.validate(value, values);
  }

  return {
    value,
    isVisible,
    isDisabled,
    isReadOnly,
    isRequired,
    label,
    placeholder,
    description,
    error,
  };
}

/**
 * Определяет, нужно ли пересчитывать поле при изменении другого поля
 *
 * ПРАВИЛА:
 * - Если changedField === fieldKey → всегда true (собственное изменение)
 * - Если dependencies === undefined → true (пересчёт при любом изменении)
 * - Если dependencies === [] → false (пересчёт только при init/reset)
 * - Если changedField в dependencies → true
 *
 * @param fieldKey - Поле, которое проверяем
 * @param changedField - Поле, которое изменилось (или null при init/reset)
 * @param config - Конфигурация формы
 * @returns true если нужно пересчитать fieldState
 *
 * @example
 * // dependencies не указан → пересчёт при любом изменении
 * shouldRecalculateField('cardNumber', 'amount', config) // → true
 *
 * // dependencies: ['paymentType']
 * shouldRecalculateField('cardNumber', 'paymentType', config) // → true
 * shouldRecalculateField('cardNumber', 'amount', config) // → false
 *
 * // dependencies: [] → только при изменении себя
 * shouldRecalculateField('comment', 'paymentType', config) // → false
 * shouldRecalculateField('comment', 'comment', config) // → true
 *
 * // changedField = null → init/reset, пересчитываем все
 * shouldRecalculateField('cardNumber', null, config) // → true
 */
export function shouldRecalculateField<TValues extends Record<string, any>>(
  fieldKey: keyof TValues,
  changedField: keyof TValues | null,
  config: FormConfig<TValues>
): boolean {
  // При init/reset (changedField = null) пересчитываем всё
  if (changedField === null) return true;

  // Собственное изменение — всегда пересчитываем
  if (fieldKey === changedField) return true;

  const fieldConfig = config[fieldKey];
  if (!fieldConfig) return true;

  const { dependencies } = fieldConfig;

  // dependencies не указан → пересчёт при любом изменении
  if (dependencies === undefined) return true;

  // dependencies = [] → пересчёт только при изменении себя (уже проверили выше)
  if (dependencies.length === 0) return false;

  // Проверяем, есть ли changedField в списке зависимостей
  return dependencies.includes(changedField);
}

/**
 * Вычисляет fieldStates для всех полей
 *
 * Используется при инициализации формы и полном пересчёте (reset, setLocale)
 *
 * @param ctx - Контекст вычисления
 * @returns Словарь вычисленных состояний всех полей
 *
 * @example
 * const fields = computeAllFieldStates({
 *   values: initialValues,
 *   config: formConfig,
 *   translate: t,
 *   locale: 'ru',
 *   showErrors: false,
 * });
 */
export function computeAllFieldStates<TValues extends Record<string, any>>(
  ctx: ComputeContext<TValues>
): FieldStates<TValues> {
  const { values, config } = ctx;
  const fields = {} as FieldStates<TValues>;

  // Вычисляем состояние для каждого поля из values
  for (const key of Object.keys(values) as Array<keyof TValues>) {
    fields[key] = computeFieldState(key, ctx);
  }

  return fields;
}

/**
 * Пересчитывает fieldStates после изменения одного поля
 *
 * Оптимизированная версия — пересчитывает только зависимые поля
 *
 * @param prevFields - Предыдущие fieldStates
 * @param changedField - Поле, которое изменилось
 * @param ctx - Контекст вычисления (с новыми values)
 * @returns Новые fieldStates (с переиспользованием неизменившихся объектов)
 *
 * @example
 * // Пользователь изменил paymentType
 * const newFields = recomputeFieldStates(
 *   prevFields,
 *   'paymentType',
 *   { values: newValues, config, translate, locale, showErrors }
 * );
 * // Пересчитаются только поля с dependencies: undefined или dependencies включает 'paymentType'
 */
export function recomputeFieldStates<TValues extends Record<string, any>>(
  prevFields: FieldStates<TValues>,
  changedField: keyof TValues,
  ctx: ComputeContext<TValues>
): FieldStates<TValues> {
  const { values, config } = ctx;
  const newFields = {} as FieldStates<TValues>;
  let hasChanges = false;

  for (const key of Object.keys(values) as Array<keyof TValues>) {
    // Проверяем, нужно ли пересчитывать это поле
    if (shouldRecalculateField(key, changedField, config)) {
      const newState = computeFieldState(key, ctx);

      // Проверяем, изменилось ли состояние
      if (isFieldStateEqual(prevFields[key], newState)) {
        // Состояние не изменилось — переиспользуем старый объект
        newFields[key] = prevFields[key];
      } else {
        // Состояние изменилось — используем новый объект
        newFields[key] = newState;
        hasChanges = true;
      }
    } else {
      // Поле не нужно пересчитывать — переиспользуем старый объект
      newFields[key] = prevFields[key];
    }
  }

  // Если ничего не изменилось, возвращаем старый объект fields
  // Это важно для React — Object.is(prevFields, newFields) === true
  return hasChanges ? newFields : prevFields;
}

/**
 * Сравнивает два ComputedFieldState на равенство
 *
 * Shallow comparison всех свойств. Если все свойства равны,
 * возвращаем true — можно переиспользовать старый объект.
 *
 * @example
 * isFieldStateEqual(
 *   { value: 'card', isVisible: true, ... },
 *   { value: 'card', isVisible: true, ... }
 * ) // → true
 *
 * isFieldStateEqual(
 *   { value: 'card', isVisible: true, ... },
 *   { value: 'card', isVisible: false, ... }
 * ) // → false
 */
export function isFieldStateEqual<TValue>(
  a: ComputedFieldState<TValue>,
  b: ComputedFieldState<TValue>
): boolean {
  return (
    Object.is(a.value, b.value) &&
    a.isVisible === b.isVisible &&
    a.isDisabled === b.isDisabled &&
    a.isReadOnly === b.isReadOnly &&
    a.isRequired === b.isRequired &&
    a.label === b.label &&
    a.placeholder === b.placeholder &&
    a.description === b.description &&
    a.error === b.error
  );
}

// ============================================================================
// Утилиты для работы с errors
// ============================================================================

/**
 * Извлекает errors из fieldStates
 *
 * Удобно для обратной совместимости — FormState.errors
 *
 * @example
 * const errors = extractErrors(fields);
 * // → { cardNumber: 'validation.required', amount: undefined }
 */
export function extractErrors<TValues extends Record<string, any>>(
  fields: FieldStates<TValues>
): Partial<Record<keyof TValues, string>> {
  const errors: Partial<Record<keyof TValues, string>> = {};

  for (const key of Object.keys(fields) as Array<keyof TValues>) {
    if (fields[key].error) {
      errors[key] = fields[key].error;
    }
  }

  return errors;
}

/**
 * Извлекает values из fieldStates
 *
 * Полезно если values хранятся только в fields
 * (для нашей архитектуры не нужно, т.к. values дублируются)
 */
export function extractValues<TValues extends Record<string, any>>(
  fields: FieldStates<TValues>
): TValues {
  const values = {} as TValues;

  for (const key of Object.keys(fields) as Array<keyof TValues>) {
    values[key] = fields[key].value;
  }

  return values;
}

// ============================================================================
// Дефолтная функция перевода
// ============================================================================

/**
 * Заглушка для translate — возвращает ключ как есть
 * Используется если translate не передан в опции формы
 */
export const defaultTranslate: TranslateFn = (key) => key;
