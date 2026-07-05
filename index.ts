/**
 * Palistor — reactive form state manager for React.
 *
 * A store is created from a declarative config (`new Palistor({ config })`)
 * and consumed in React through `useForm(store)`, which returns a tracking
 * proxy: components re-render only when a field they actually read changes.
 *
 * @example
 * ```ts
 * // config/orderForm.ts — module level
 * import { Palistor } from "palistor";
 *
 * export const orderStore = new Palistor({
 *   config: {
 *     name:  { value: "", isRequired: true },
 *     email: { value: "", validate: (v) => (!v.includes("@") ? "Invalid email" : undefined) },
 *   },
 * });
 * ```
 *
 * ```tsx
 * // Component — subscribes via useForm
 * import { useForm } from "palistor";
 *
 * const form = useForm(orderStore);
 * return <input value={form.name.value} onChange={(e) => form.name.onValueChange(e.target.value)} />;
 * ```
 */

// ============================================================================
// Persist — drivers and types
// ============================================================================

export type { PersistDriver, PersistOptions } from "./store/persist/types";
export type { PersistManager } from "./store/persist/persistManager";
export { localStorageDriver, sessionStorageDriver } from "./store/persist/drivers";

// ============================================================================
// Store types (config, proxy, values)
// ============================================================================

export type {
  FlowProxyNode,
  FlowStepProxy,
  FlowStepsProxy,
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
// Resolve — types and hooks
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
// defineFlow / defineStep — step-based flow primitive
// ============================================================================

export { defineFlow, defineStep } from "./store/flow/defineFlow";
export type {
  AnyFlowStep,
  DefineFlowOptions,
  FlowError,
  FlowNode,
  FlowStep,
  FlowValues,
  StepStatus,
} from "./store/flow/defineFlow";

// ============================================================================
// defineFieldMapping — typed fieldMapping helper (preserves literals)
// ============================================================================

export { defineFieldMapping } from "./store/defineFieldMapping";
