/**
 * Palistor - Типы для state manager
 */

// ============================================================================
// Core Store Types
// ============================================================================

export type Listener = () => void;

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
 */
export interface FieldConfig<TValue = any, TValues = Record<string, any>> {
  /** Начальное значение или computed функция */
  value?: TValue | ((values: TValues) => TValue);
  
  /** Ключ перевода для label или функция */
  label?: string | ((translate: any, settings?: any) => string);
  
  /** Placeholder */
  placeholder?: string | ((translate: any, settings?: any) => string);
  
  /** Описание поля */
  description?: string | ((translate: any, settings?: any) => string);
  
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
 * Состояние одной формы
 */
export interface FormState<TValues extends Record<string, any>> {
  /** Текущие значения полей */
  values: TValues;
  
  /** Ошибки валидации */
  errors: Partial<Record<keyof TValues, string>>;
  
  /** Флаг процесса отправки */
  submitting: boolean;
  
  /** Флаг "форма изменена" */
  dirty: boolean;
  
  /** Показывать ошибки (после первого submit) */
  showErrors: boolean;
  
  /** Начальные значения (для вычисления dirty) */
  initialValues: TValues;
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
 */
export interface FormStoreApi<TValues extends Record<string, any>> {
  /** Текущие значения */
  values: TValues;
  
  /** Текущие ошибки */
  errors: Partial<Record<keyof TValues, string>>;
  
  /** Флаг отправки */
  submitting: boolean;
  
  /** Флаг изменения */
  dirty: boolean;
  
  /** Установить значение поля */
  setValue: <K extends keyof TValues>(key: K, value: TValues[K]) => void;
  
  /** Сбросить форму */
  reset: (next?: Partial<TValues>) => void;
  
  /** Отправить форму */
  submit: () => Promise<void>;
  
  /** Валидация одного поля */
  validateField: (key: keyof TValues) => void;
  
  /** Валидация всей формы */
  validateForm: () => boolean;
  
  /** Получить список видимых полей */
  getVisibleFields: () => Array<keyof TValues & string>;
  
  /** Получить пропсы для поля (HeroUI-совместимые) */
  getFieldProps: <K extends keyof TValues>(key: K) => FieldProps<TValues[K]>;
}

/**
 * Пропсы поля для UI компонента
 */
export interface FieldProps<TValue = any> {
  value: TValue;
  onValueChange: (value: TValue) => void;
  isDisabled: boolean;
  isReadOnly: boolean;
  isRequired: boolean;
  isInvalid: boolean;
  errorMessage?: string;
  label?: string;
  placeholder?: string;
  description?: string;
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
