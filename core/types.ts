/**
 * Palistor - Типы для state manager
 */

// ============================================================================
// Nested Field Types
// ============================================================================

/**
 * Рекурсивный тип для получения всех возможных путей к вложенным полям
 * 
 * @example
 * type User = { name: string; address: { city: string; zip: number } };
 * type Keys = NestedKeyOf<User>; 
 * // → "name" | "address" | "address.city" | "address.zip"
 */
export type NestedKeyOf<T> = {
  [K in keyof T & string]: T[K] extends Record<string, any>
    ? T[K] extends any[]
      ? K
      : K | `${K}.${NestedKeyOf<T[K]>}`
    : K;
}[keyof T & string];

/**
 * Получает тип значения по вложенному пути
 * 
 * @example
 * type User = { address: { city: string } };
 * type City = NestedValueOf<User, "address.city">; // → string
 */
export type NestedValueOf<T, Path extends string> = 
  Path extends `${infer K}.${infer Rest}`
    ? K extends keyof T
      ? NestedValueOf<T[K], Rest>
      : never
    : Path extends keyof T
      ? T[Path]
      : never;

// ============================================================================
// Core Store Types
// ============================================================================

export type Listener = () => void;

/** Функция перевода (i18n) */
export type TranslateFn = (key: string, params?: Record<string, any>) => string;

/**
 * Конвертирует тип значения поля в тип для onValueChange
 * - Если поле number → string | number (потому что Input может вернуть и то и то)
 * - Остальные типы → как есть
 */
export type InputValueType<T> = T extends number ? string | number : T;

export interface Store<T> {
  getState: () => T;
  setState: (next: T | ((prev: T) => T)) => void;
  subscribe: (listener: Listener) => () => void;
}

// ============================================================================
// Form Field Config Types
// ============================================================================

/**
 * Конфиг одного поля формы
 * Совместим с текущим GenericFormProvider
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * СИСТЕМА ЗАВИСИМОСТЕЙ (dependencies)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Массив `dependencies` определяет, при изменении КАКИХ полей нужно
 * пересчитать вычисляемые свойства ЭТОГО поля.
 *
 * ПРАВИЛА ПЕРЕСЧЁТА:
 * ┌─────────────────────────┬────────────────────────────────────────────────┐
 * │ dependencies            │ Когда пересчитывается fieldState               │
 * ├─────────────────────────┼────────────────────────────────────────────────┤
 * │ undefined (не указан)   │ При изменении ЛЮБОГО поля (включая себя)       │
 * │ ['field1', 'field2']    │ При изменении field1, field2 ИЛИ себя          │
 * │ [] (пустой массив)      │ Только при изменении СЕБЯ или при init/reset   │
 * └─────────────────────────┴────────────────────────────────────────────────┘
 *
 * ВАЖНО: Поле ВСЕГДА пересчитывается при изменении собственного value.
 * Массив dependencies добавляет ДОПОЛНИТЕЛЬНЫЕ триггеры.
 *
 * ПРИМЕРЫ:
 * ```ts
 * const config: FormConfig<PaymentForm> = {
 *   // Поле без зависимостей — пересчитывается при любом изменении
 *   paymentType: {
 *     value: 'card',
 *     // dependencies не указан → пересчёт при изменении любого поля
 *   },
 *
 *   // Поле зависит от paymentType
 *   cardNumber: {
 *     value: '',
 *     isVisible: (values) => values.paymentType === 'card',
 *     isRequired: (values) => values.paymentType === 'card',
 *     dependencies: ['paymentType'], // ← пересчёт при изменении paymentType или себя
 *   },
 *
 *   // Поле с пустым массивом — пересчёт только при изменении себя
 *   comment: {
 *     value: '',
 *     label: (t) => t('form.comment'),
 *     dependencies: [], // ← пересчёт только при init/reset или изменении comment
 *   },
 *
 *   // Сложная зависимость от нескольких полей
 *   totalAmount: {
 *     value: 0,
 *     isVisible: (values) => values.paymentType !== 'free' && values.items.length > 0,
 *     dependencies: ['paymentType', 'items'],
 *   },
 * };
 * ```
 *
 * ОПТИМИЗАЦИЯ:
 * - Если форма большая (>50 полей), рекомендуется указывать dependencies явно
 * - Для статических полей (только label/placeholder) используйте dependencies: []
 * - JavaScript быстро пересчитывает объекты, но React рендеринг дорогой
 */
export interface FieldConfig<TValue = any, TValues = Record<string, any>> {
  /** Начальное значение или computed функция */
  value?: TValue | ((values: TValues) => TValue);

  /** Ключ перевода для label или функция */
  label?: string | ((translate: TranslateFn, settings?: any) => string);

  /** Placeholder */
  placeholder?: string | ((translate: TranslateFn, settings?: any) => string);

  /** Описание поля */
  description?: string | ((translate: TranslateFn, settings?: any) => string);

  /** Валидация - возвращает ключ ошибки или undefined */
  validate?: (value: TValue, values: TValues) => string | undefined;

  /** Форматтер значения при вводе */
  formatter?: (value: TValue, values: TValues) => TValue;

  /** Кастомный сеттер для изменения нескольких полей */
  setter?: (
    value: TValue,
    values: TValues,
    setValues: (next: Partial<TValues>, fieldName: keyof TValues) => void
  ) => void;

  /** Флаг обязательности - boolean или функция */
  isRequired?: boolean | ((values: TValues) => boolean);

  /** Флаг только для чтения */
  isReadOnly?: boolean | ((values: TValues) => boolean);

  /** Флаг disabled */
  isDisabled?: boolean | ((values: TValues) => boolean);

  /** Видимость поля */
  isVisible?: boolean | ((values: TValues) => boolean);

  /**
   * Массив зависимостей — имена полей, при изменении которых
   * нужно пересчитать fieldState этого поля.
   *
   * - undefined → пересчёт при изменении ЛЮБОГО поля
   * - ['field1'] → пересчёт при изменении field1 или себя
   * - [] → пересчёт только при изменении себя или init/reset
   * 
   * Поддерживает вложенные пути: dependencies: ['passport.number']
   */
  dependencies?: readonly string[] | string[];

  /** 
   * Вложенные поля (для объектов)
   * Если true, то остальные ключи в этом объекте - это конфиги дочерних полей
   * 
   * @example
   * passport: {
   *   nested: true,
   *   number: { value: "", label: "Number" },
   *   issueDate: { value: "", label: "Issue Date" }
   * }
   * // Доступ через: getFieldProps("passport.number")
   */
  nested?: boolean;

  /** Дополнительные пропсы для компонента */
  componentProps?: Record<string, unknown>;

  /** Типизация поля (для будущей валидации по типам) */
  types?: {
    dataType: "String" | "Number" | "Boolean" | "Date" | "Array" | "Object";
    type: string;
  };

  // Индексная сигнатура для вложенных полей
  [nestedKey: string]: any;
}

/**
 * Конфиг всей формы - словарь полей
 */
export type FormConfig<TValues extends Record<string, any>> = {
  [K in keyof TValues]?: FieldConfig<TValues[K], TValues>;
};

// ============================================================================
// Form State Types
// ============================================================================

/**
 * Вычисленное состояние одного поля
 *
 * Это "материализованный" результат вычисления всех функций из FieldConfig.
 * Хранится в FormState.fields и пересчитывается при изменении зависимостей.
 *
 * ПРИМЕР:
 * ```ts
 * // FieldConfig (конфигурация — функции)
 * cardNumber: {
 *   isVisible: (values) => values.paymentType === 'card',
 *   isRequired: (values) => values.paymentType === 'card',
 *   label: (t) => t('form.cardNumber'),
 * }
 *
 * // ComputedFieldState (вычисленное состояние — значения)
 * cardNumber: {
 *   value: '4111111111111111',
 *   isVisible: true,        // ← вычислено из функции
 *   isRequired: true,       // ← вычислено из функции
 *   isDisabled: false,      // ← default
 *   isReadOnly: false,      // ← default
 *   label: 'Card Number',   // ← вычислено с translate
 *   error: undefined,
 * }
 * ```
 */
export interface ComputedFieldState<TValue = any> {
  /** Текущее значение поля */
  value: TValue;
  /** Видимость поля */
  isVisible: boolean;
  /** Поле отключено */
  isDisabled: boolean;
  /** Только для чтения */
  isReadOnly: boolean;
  /** Обязательное поле */
  isRequired: boolean;
  /** Вычисленный label */
  label?: string;
  /** Вычисленный placeholder */
  placeholder?: string;
  /** Вычисленное описание */
  description?: string;
  /** Ошибка валидации (если showErrors=true) */
  error?: string;
}

/**
 * Словарь вычисленных состояний всех полей
 * Поддерживает вложенные ключи: fields["passport.number"]
 */
export type FieldStates<TValues extends Record<string, any>> = Record<string, ComputedFieldState<any>>;

/**
 * Состояние одной формы
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * АРХИТЕКТУРА РЕАКТИВНОСТИ (Computed State + Dependencies)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * СТРУКТУРА ДАННЫХ:
 * ```
 * FormState
 * ├── values: { paymentType: 'card', cardNumber: '4111...', amount: 100 }
 * │   └── Плоский объект для обратной совместимости и удобства
 * │
 * ├── fields: {
 * │   paymentType: { value, isVisible, isDisabled, isRequired, label, ... },
 * │   cardNumber:  { value, isVisible, isDisabled, isRequired, label, ... },
 * │   amount:      { value, isVisible, isDisabled, isRequired, label, ... },
 * │   }
 * │   └── Полное вычисленное состояние каждого поля для подписки
 * │
 * ├── errors: { cardNumber: 'validation.required' }
 * │   └── Отдельно для быстрого доступа к ошибкам
 * │
 * └── submitting, dirty, showErrors, initialValues, locale
 *     └── Метаданные формы
 * ```
 *
 * ПОТОК ДАННЫХ при setValue('paymentType', 'bank'):
 * ```
 * 1. setValue('paymentType', 'bank')
 *    │
 * 2. ├── Обновляем values: { ...values, paymentType: 'bank' }
 *    │
 * 3. ├── Определяем какие поля пересчитать:
 *    │   │
 *    │   ├── paymentType: dependencies=undefined → пересчитать (любое изменение)
 *    │   ├── cardNumber: dependencies=['paymentType'] → пересчитать (триггер в списке)
 *    │   ├── bankAccount: dependencies=['paymentType'] → пересчитать
 *    │   └── comment: dependencies=[] → НЕ пересчитывать (пустой список)
 *    │
 * 4. ├── Пересчитываем fieldStates для выбранных полей:
 *    │   cardNumber.isVisible = config.cardNumber.isVisible(newValues) → false
 *    │   bankAccount.isVisible = config.bankAccount.isVisible(newValues) → true
 *    │
 * 5. └── store.setState({ values, fields, errors, dirty: true })
 *        │
 *        └── React компоненты получают уведомление через useSelector
 * ```
 *
 * ОПТИМИЗАЦИЯ РЕНДЕРИНГА:
 * ```ts
 * // Компонент подписывается ТОЛЬКО на своё поле
 * const cardNumberField = useSelector(formId, (state) => state.fields.cardNumber);
 *
 * // React сравнивает объекты по ссылке:
 * // - Если cardNumber.isVisible изменился → новый объект → ре-рендер
 * // - Если cardNumber не изменился → тот же объект → НЕТ ре-рендера
 * ```
 *
 * ПРИМЕР ПОЛНОГО ЦИКЛА:
 * ```ts
 * // 1. Создание формы
 * const form = createForm({
 *   id: 'payment',
 *   locale: 'ru',
 *   config: {
 *     paymentType: { value: 'card' },
 *     cardNumber: {
 *       value: '',
 *       isVisible: (v) => v.paymentType === 'card',
 *       dependencies: ['paymentType'],
 *     },
 *   },
 *   defaults: { paymentType: 'card', cardNumber: '' },
 * });
 *
 * // 2. Начальное состояние
 * // state.values = { paymentType: 'card', cardNumber: '' }
 * // state.fields.cardNumber = { value: '', isVisible: true, ... }
 *
 * // 3. Пользователь меняет paymentType
 * form.setValue('paymentType', 'bank');
 *
 * // 4. Новое состояние
 * // state.values = { paymentType: 'bank', cardNumber: '' }
 * // state.fields.cardNumber = { value: '', isVisible: false, ... }  ← изменилось!
 *
 * // 5. React
 * // - Компонент CardNumber получает новый fields.cardNumber
 * // - isVisible=false → компонент скрывается (или рендерит null)
 * ```
 *
 * СМЕНА ЛОКАЛИ:
 * ```ts
 * form.setLocale('en');
 * // → Пересчитываются ВСЕ поля (label, placeholder, description)
 * // → Все компоненты получают обновлённые строки
 * ```
 */
export interface FormState<TValues extends Record<string, any>> {
  /**
   * Текущие значения полей (может быть вложенным объектом)
   * Для доступа к вложенным полям: values.passport.number
   */
  values: TValues;

  /**
   * Вычисленное состояние каждого поля
   * Поддерживает вложенные ключи: fields["passport.number"]
   */
  fields: FieldStates<TValues>;

  /**
   * Ошибки валидации
   * Поддерживает вложенные ключи: errors["passport.number"]
   */
  errors: Record<string, string>;

  /** Флаг процесса отправки */
  submitting: boolean;

  /** Флаг "форма изменена" */
  dirty: boolean;

  /** Показывать ошибки (после первого submit) */
  showErrors: boolean;

  /** Начальные значения (для вычисления dirty и reset) */
  initialValues: TValues;

  /**
   * Текущая локаль для translate функций
   * При изменении пересчитываются все label/placeholder/description
   */
  locale: string;
}

// ============================================================================
// Field Props Types
// ============================================================================

/**
 * Пропсы поля для UI компонента
 *
 * Расширяет ComputedFieldState, добавляя:
 * - onValueChange — колбэк для изменения значения
 * - isInvalid — флаг наличия ошибки (для HeroUI)
 * - errorMessage — текст ошибки (алиас для error)
 */
export interface FieldProps<TValue = any> extends ComputedFieldState<TValue> {
  /** Колбэк изменения значения (для controlled компонентов) */
  onValueChange: (value: InputValueType<TValue>) => void;
  /** Флаг наличия ошибки (HeroUI-совместимый) */
  isInvalid: boolean;
  /** Текст ошибки (алиас для error, HeroUI-совместимый) */
  errorMessage?: string;
}
