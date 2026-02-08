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
// Главный API — createForm
// ============================================================================

export { createForm, getFormStore, hasFormStore, removeFormStore, getRegistryKeys } from "./core/createForm";
export type { CreateFormConfig, UseFormOptions, UseFormReturn } from "./core/createForm";

// ============================================================================
// Core (low-level)
// ============================================================================

export { createStore } from "./core/createStore";

// Types
export type {
  // Store types
  Store,
  Listener,
  TranslateFn,

  // Form types
  FieldConfig,
  FormConfig,
  FormState,
  FieldProps,
  ComputedFieldState,
  FieldStates,
  InputValueType,
} from "./core/types";

// Computed fields utilities
export {
  computeFieldState,
  computeAllFieldStates,
  recomputeFieldStates,
  shouldRecalculateField,
  isFieldStateEqual,
  extractErrors,
  extractValues,
  defaultTranslate,
  type ComputeContext,
} from "./core/computeFields";

// Actions — чистые функции для работы с состоянием
export {
  createInitialState,
  setFieldValue,
  setFieldValues,
  resetForm,
  setFormLocale,
  enableShowErrors,
  setSubmitting,
  hasErrors,
  isFormValid,
  getVisibleFieldKeys,
  computeDirty,
  type ActionContext,
} from "./core/actions";

// ============================================================================
// React (low-level escape hatch)
// ============================================================================

export { useSelector, shallowEqual } from "./react/useSelector";

// ============================================================================
// Utils
// ============================================================================

export {
  mergeState,
  materializeComputed,
  difference,
} from "./utils/materialize";
export {
  getPersistedState,
  setPersistedState,
  clearPersistedState,
} from "./utils/persistence";
