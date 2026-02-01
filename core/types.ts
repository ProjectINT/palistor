/**
 * Palistor - Типы для state manager
 */

// ============================================================================
// Core Store Types
// ============================================================================

export type Listener = () => void;

/** Функция перевода (i18n) */
export type TranslateFn = (key: string, params?: Record<string, any>) => string;

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

  /** Флаг обязательности - boolean, string (сообщение) или функция */
  isRequired?: boolean | string | ((values: TValues) => boolean | string);

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
   */
  dependencies?: Array<keyof TValues>;

  /** Вложенные поля (для объектов) */
  nested?: boolean;

  /** Дополнительные пропсы для компонента */
  componentProps?: Record<string, unknown>;

  /** Типизация поля (для будущей валидации по типам) */
  types?: {
    dataType: string;
    type: string;
  };
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
 */
export type FieldStates<TValues extends Record<string, any>> = {
  [K in keyof TValues]: ComputedFieldState<TValues[K]>;
};

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
   * Текущие значения полей (плоский объект)
   * Для обратной совместимости и удобного доступа: values.fieldName
   */
  values: TValues;

  /**
   * Вычисленное состояние каждого поля
   * Для подписки на конкретное поле: fields.fieldName
   */
  fields: FieldStates<TValues>;

  /**
   * Ошибки валидации
   * Отдельно для быстрого доступа без обхода fields
   */
  errors: Partial<Record<keyof TValues, string>>;

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
// Form Store Types
// ============================================================================

/**
 * Опции создания формы
 */
export interface CreateFormOptions<TValues extends Record<string, any>> {
  /** Уникальный ID формы */
  id: string;

  /** Конфигурация полей */
  config: FormConfig<TValues>;

  /** Значения по умолчанию */
  defaults: TValues;

  /** Начальные значения (например, с сервера) */
  initial?: Partial<TValues>;

  /**
   * Текущая локаль (для translate функций в label/placeholder/description)
   * При изменении через setLocale() все строковые свойства пересчитываются
   */
  locale?: string;

  /**
   * Функция перевода (i18n)
   * Вызывается при вычислении label/placeholder/description
   */
  translate?: TranslateFn;

  /** ID для сохранения черновика в localStorage */
  persistId?: string;

  /** Колбэк при изменении поля */
  onChange?: (params: {
    fieldKey: keyof TValues;
    newValue: any;
    previousValue: any;
    allValues: TValues;
  }) => void | Partial<TValues> | Promise<void | Partial<TValues>>;

  /** Хук перед отправкой */
  beforeSubmit?: (values: TValues) => TValues | Promise<TValues>;

  /** Обработчик отправки */
  onSubmit?: (values: TValues) => void | Promise<any>;

  /** Хук после отправки */
  afterSubmit?: (data: any, reset: () => void) => void | Promise<void>;
}

/**
 * API одной формы (возвращается хуком)
 *
 * ИСПОЛЬЗОВАНИЕ В REACT:
 * ```tsx
 * function PaymentForm() {
 *   const form = useFormStore<PaymentValues>('payment');
 *
 *   // Вариант 1: Доступ к values напрямую (обратная совместимость)
 *   const paymentType = form.values.paymentType;
 *
 *   // Вариант 2: Подписка на конкретное поле через fields
 *   const cardNumberField = form.fields.cardNumber;
 *   // cardNumberField = { value, isVisible, isDisabled, isRequired, label, ... }
 *
 *   // Вариант 3: getFieldProps для UI компонента (добавляет onValueChange)
 *   const cardNumberProps = form.getFieldProps('cardNumber');
 *   return <Input {...cardNumberProps} />;
 * }
 * ```
 */
export interface FormStoreApi<TValues extends Record<string, any>> {
  /**
   * Текущие значения (плоский объект)
   * @example form.values.paymentType
   */
  values: TValues;

  /**
   * Вычисленное состояние каждого поля
   * Используйте для подписки на конкретное поле
   * @example form.fields.cardNumber.isVisible
   */
  fields: FieldStates<TValues>;

  /**
   * Текущие ошибки валидации
   * @example form.errors.cardNumber // → 'validation.required'
   */
  errors: Partial<Record<keyof TValues, string>>;

  /** Флаг отправки */
  submitting: boolean;

  /** Флаг изменения */
  dirty: boolean;

  /**
   * Установить значение поля
   * Автоматически пересчитывает fieldStates зависимых полей
   */
  setValue: <K extends keyof TValues>(key: K, value: TValues[K]) => void;

  /**
   * Сбросить форму к начальным значениям
   * Пересчитывает ВСЕ fieldStates
   */
  reset: (next?: Partial<TValues>) => void;

  /**
   * Изменить локаль
   * Пересчитывает ВСЕ label/placeholder/description
   */
  setLocale: (locale: string) => void;

  /** Отправить форму */
  submit: () => Promise<void>;

  /** Валидация одного поля */
  validateField: (key: keyof TValues) => void;

  /** Валидация всей формы */
  validateForm: () => boolean;

  /** Получить список видимых полей */
  getVisibleFields: () => Array<keyof TValues & string>;

  /**
   * Получить пропсы для UI компонента (HeroUI-совместимые)
   * Добавляет onValueChange колбэк к ComputedFieldState
   */
  getFieldProps: <K extends keyof TValues>(key: K) => FieldProps<TValues[K]>;
}

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
  onValueChange: (value: TValue) => void;
  /** Флаг наличия ошибки (HeroUI-совместимый) */
  isInvalid: boolean;
  /** Текст ошибки (алиас для error, HeroUI-совместимый) */
  errorMessage?: string;
}

// ============================================================================
// Registry Types
// ============================================================================

/**
 * Запись в глобальном реестре форм
 */
export interface FormRegistryEntry<TValues extends Record<string, any> = any> {
  store: Store<FormState<TValues>>;
  config: FormConfig<TValues>;
  options: CreateFormOptions<TValues>;
}

/**
 * Глобальный реестр всех форм
 */
export interface FormRegistry {
  forms: Map<string, FormRegistryEntry>;
  /** Зарегистрировать форму */
  register: <TValues extends Record<string, any>>(
    options: CreateFormOptions<TValues>
  ) => FormRegistryEntry<TValues>;
  /** Получить форму по ID */
  get: <TValues extends Record<string, any>>(id: string) => FormRegistryEntry<TValues> | undefined;
  /** Удалить форму из реестра */
  unregister: (id: string) => void;
  /** Проверить наличие формы */
  has: (id: string) => boolean;
}
