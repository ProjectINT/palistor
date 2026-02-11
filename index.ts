/**
 * Palistor - State Manager для форм
 *
 * Архитектура: createForm + useForm(id)
 *
 * createForm() вызывается на уровне модуля — задаёт статическую конфигурацию.
 * useForm(id) вызывается в React-компоненте — привязывает к экземпляру.
 *
 * @example
 * ```ts
 * // config/orderForm.ts — модульный уровень
 * import { createForm } from 'palistor';
 * import { useTranslations } from 'next-intl';
 *
 * export const { useForm } = createForm<OrderValues>({
 *   config: orderConfig,
 *   defaults: orderDefaults,
 *   translateFunction: useTranslations,
 *   type: "Order",
 * });
 * ```
 *
 * ```tsx
 * // Корневой компонент — передаёт initial и колбэки
 * const { getFieldProps, submit } = useForm(order?.id ?? "NewOrder", {
 *   initial: order,
 *   onSubmit: async (values) => { await api.saveOrder(values); },
 * });
 *
 * return <Input {...getFieldProps("name")} />;
 * ```
 *
 * ```tsx
 * // Вложенный компонент — подключается к существующему store
 * const { getFieldProps } = useForm(orderId);
 *
 * return <Input {...getFieldProps("name")} />;
 * ```
 */

// ============================================================================
// Публичный API
// ============================================================================

export { createForm } from "./core/createForm";
export type { CreateFormConfig, UseFormOptions, UseFormReturn } from "./core/createForm";

// ============================================================================
// Типы для конфигурации
// ============================================================================

export type {
  TranslateFn,
  FieldConfig,
  FormConfig,
  FormState,
  FieldProps,
  InputValueType,
  NestedKeyOf,
  NestedValueOf,
} from "./core/types";

// ============================================================================
// Утилиты для работы с вложенными полями
// ============================================================================

export { 
  parseFieldKey, 
  stringifyPath, 
  isNestedKey, 
  getRootKey, 
  getNestedPath,
  isReservedFieldConfigKey,
  getFieldConfigByPath,
} from "./utils/pathUtils";
export { getFieldByPath, setFieldByPath, removeFieldByPath } from "./utils/helpers";
