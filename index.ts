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
  MaybeTranslatable,
  DeepPartialValues,
  FieldTypeMeta,
  ConfigNode,
  FieldProxyNode,
  GroupProxyNode,
  ConfigProxy,
  FieldMapping,
  ApplyFieldMapping,
  ValidateExternalConfig,
  ConfigKeyError,
  ExternalConfig,
  ExternalConfigNode,
  RawStoreProxy,
  RawStoreProxyMarker,
  ExtractValues,
  ProxyStoreOptions,
  ProxyStore,
  Unsubscribe,
  PalistorRef,
  PalistorList,
  PalistorEntityProxy,
  TypedListNode,
  ListResolver,
  TemplateConfig,
  InferEntity,
} from "./store/store/types";
export type { Palistor as PalistorProxy } from "./store/store/types";
export { Palistor } from "./store/store";

// ============================================================================
// Resolve — типы и хуки
// ============================================================================

export type { Resolve, NotifyFn, ResolveErrorContext } from "./store/resolvePipeline/";
export { useNotifier } from "./react/useNotifier";

// ============================================================================
// React hooks
// ============================================================================

export { useForm } from "./react/useForm";
export { usePersist } from "./react/usePersist";
export { useTranslator } from "./react/useTranslator";
export { useStoreContext } from "./react/useStoreContext";

// ============================================================================
// defineList — typed list helper
// ============================================================================

export { defineList } from "./store/defineList";

// ============================================================================
// defineFieldMapping — typed fieldMapping helper (сохраняет литералы)
// ============================================================================

export { defineFieldMapping } from "./store/defineFieldMapping";