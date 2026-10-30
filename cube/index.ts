/**
 * Palistor on the Cube core (experimental, `palistor/cube`).
 *
 * Repeats the export list of the root `index.ts` name for name. Runtime values
 * come from the Cube core; every type is re-exported from the store
 * implementation, so consumer code type-checks the same against both. Exports
 * the core doesn't cover yet keep their name and throw NotImplementedError.
 * Rollout: experiments/CubePlan.md.
 */

import type { Palistor as StorePalistor } from "../store/store";
import type { FieldMapping } from "../store/store/types";
import type { localStorageDriver as StoreLocalStorageDriver } from "../store/persist/drivers";
import type { useNotifier as StoreUseNotifier } from "../react/useNotifier";
import type { useForm as StoreUseForm } from "../react/useForm";
import type { usePersist as StoreUsePersist } from "../react/usePersist";
import type { useTranslator as StoreUseTranslator } from "../react/useTranslator";
import type { useStoreContext as StoreUseStoreContext } from "../react/useStoreContext";
import type { defineList as StoreDefineList } from "../store/defineList";
import type { defineFlow as StoreDefineFlow, defineStep as StoreDefineStep } from "../store/flow/defineFlow";
import type { defineFieldMapping as StoreDefineFieldMapping } from "../store/defineFieldMapping";

import { Palistor as CubePalistor } from "./palistor";
import { useForm as cubeUseForm } from "./react/useForm";
import { useStoreContext as cubeUseStoreContext } from "./react/useStoreContext";
import { defineList as cubeDefineList } from "./defineList";
import { stub } from "./notImplemented";

// ============================================================================
// Persist — drivers and types
// ============================================================================

export type { PersistDriver, PersistOptions } from "../store/persist/types";
export type { PersistManager } from "../store/persist/persistManager";

const driverStub = (name: string): typeof StoreLocalStorageDriver => ({
  getItem: stub(`${name}.getItem()`),
  setItem: stub(`${name}.setItem()`),
  removeItem: stub(`${name}.removeItem()`),
});
// TODO(Phase 2.4): persist
export const localStorageDriver = driverStub("localStorageDriver");
export const sessionStorageDriver = driverStub("sessionStorageDriver");

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
  ListProxyNode,
  ListResolveContext,
  FilterBlock,
  FilterFieldConfig,
  FilterProxyNode,
  PaginationConfig,
  PageMode,
  PageRequest,
  PagedResult,
} from "../store/store/types";
export type { Palistor as PalistorProxy } from "../store/store/types";

export const Palistor = CubePalistor as unknown as typeof StorePalistor;
export type Palistor<
  TConfig extends Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  TMapping extends FieldMapping = {},
> = StorePalistor<TConfig, TMapping>;

// ============================================================================
// Resolve — types and hooks
// ============================================================================

export type { Resolve, NotifyFn, ResolveErrorContext, ResolveStatus } from "../store/resolvePipeline/";
// TODO(Phase 2.2): React bindings
export const useNotifier: typeof StoreUseNotifier = stub("useNotifier()");

// ============================================================================
// React hooks
// ============================================================================

export const useForm = cubeUseForm as unknown as typeof StoreUseForm;
// TODO(Phase 2.4): persist
export const usePersist: typeof StoreUsePersist = stub("usePersist()");
// TODO(Phase 2.2): React bindings
export const useTranslator: typeof StoreUseTranslator = stub("useTranslator()");
export const useStoreContext = cubeUseStoreContext as unknown as typeof StoreUseStoreContext;

// ============================================================================
// defineList — typed list helper
// ============================================================================

export const defineList = cubeDefineList as unknown as typeof StoreDefineList;

// ============================================================================
// defineFlow / defineStep — step-based flow primitive
// ============================================================================

// TODO(Phase 2.7): flows
export const defineFlow: typeof StoreDefineFlow = stub("defineFlow()");
export const defineStep: typeof StoreDefineStep = stub("defineStep()");
export type {
  AnyFlowStep,
  DefineFlowOptions,
  FlowError,
  FlowNode,
  FlowStep,
  FlowValues,
  StepStatus,
} from "../store/flow/defineFlow";

// ============================================================================
// defineFieldMapping — typed fieldMapping helper (preserves literals)
// ============================================================================

// The helper itself is an identity; the store rejects `fieldMapping` until Phase 2.6.
export const defineFieldMapping: typeof StoreDefineFieldMapping = (mapping) => mapping;
