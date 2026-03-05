/**
 * Вычисленное состояние поля — то, что видит UI-компонент.
 * Включает текущее значение, метаданные и коллбэки для записи.
 */
export interface ComputedFieldState {
  value?: any;
  label?: string;
  placeholder?: string;
  description?: string;
  isVisible?: boolean;
  isRequired?: boolean;
  isDisabled?: boolean;
  isReadOnly?: boolean;
  error?: string;
  errorMessage?: string;
  isInvalid?: boolean;
  onValueChange?: (value: any) => void;
  onChange?: (e: React.ChangeEvent<any>) => void;
}

/**
 * Функция перевода (next-intl, i18next и т.д.).
 * Принимает ключ → возвращает локализованную строку.
 */
export type TranslateFn = (key: string, params?: Record<string, any>) => string;

/**
 * Конфигурация формы — запись узлов конфига.
 * Каждый узел может быть листовым (содержит `value`) или групповым (нет `value`).
 */
export type FormConfig<_TValues extends Record<string, any> = Record<string, any>> = Record<string, any>;

/**
 * Состояние формы — значения всех полей.
 */
export type FormState<TValues extends Record<string, any> = Record<string, any>> = TValues;

/**
 * Пропсы поля для UI-компонентов (алиас ComputedFieldState).
 */
export type FieldProps = ComputedFieldState;

/**
 * Допустимые типы значений полей ввода.
 */
export type InputValueType = string | number | boolean | null | undefined;

/**
 * Конфигурация одного поля формы (алиас для совместимости).
 */
export type FieldConfig = Record<string, any>;

/**
 * Вспомогательный тип для вложенных ключей.
 */
export type NestedKeyOf<T> = string;

/**
 * Вспомогательный тип для вложенных значений.
 */
export type NestedValueOf<T, _K extends string> = any;

