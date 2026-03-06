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
// Persist — драйверы и типы
// ============================================================================

export type { PersistDriver, PersistOptions } from "./store/persist/types";
export type { PersistManager } from "./store/persist/persistManager";
export { localStorageDriver, sessionStorageDriver } from "./store/persist/drivers";

// ============================================================================
// Типы Store (config, proxy, values)
// ============================================================================

export type {
  TranslateFn,
  FormConfig,
  MaybeComputed,
  DeepPartialValues,
  FieldTypeMeta,
  ConfigNode,
  FieldProxyNode,
  GroupProxyNode,
  ConfigProxy,
  ExtractValues,
  ProxyStoreOptions,
  ProxyStore,
  Unsubscribe,
} from "./store/types";

// ============================================================================
// Resolve — типы и хуки
// ============================================================================

export type { Resolve, NotifyFn, ResolveErrorContext } from "./store/resolvePipeline";
export { useNotifier } from "./react/useNotifier";