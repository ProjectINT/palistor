/**
 * Palistor on the Cube core (experimental, `palistor/cube`).
 *
 * Repeats the export list of the store entry (`index.store.ts`) name for name.
 * Runtime values come from the Cube core; every type is re-exported from the
 * store implementation, so consumer code type-checks the same against both.
 * Rollout: experiments/CubePlan.md.
 *
 * On top of that list, Cube only (experiments/SsrPlan.md): `usePalistor`,
 * `PalistorProvider`, `usePalistorContext`, and the `Palistor` constructor
 * takes `translator` / `notifier` / `server` / `initialData` and its instances
 * have `start()`. `useForm` has one overload more: a field handed down as a
 * prop. Their types live in cube/types.ts.
 *
 * The second intended divergence, list sorting (experiments/SortPlan.md,
 * decision 15): the `sort` block of `defineList`, `list.sort`, `ctx.sort`.
 * Their types (`SortBlock`, `SortFieldConfig`, `SortProxyNode`, `SortRequest`,
 * `SortKey`, `SortDirection`) are declared in store/store/types.ts, because
 * `ListProxyNode` and `ListResolveContext` live there, but only Cube runs
 * them: on the store implementation `defineList` drops the block,
 * `list.sort` is undefined and `ctx.sort` is not passed. For the same reason
 * this entry exports `ListResolveContext` with `sort` required (the store's
 * `ListResolveContextWithSort`), and `useForm` takes a sort node.
 *
 * The same holds for the filter's apply mode (SortPlan decision 14):
 * `$apply` / `apply` in a `filter` block and `apply()`, `revert()`, `isDraft`,
 * `applied` on `list.filter` are typed in store/store/types.ts and run only
 * here; the store implementation rejects `$apply` as an unknown block option.
 * `useForm` takes a filter node too.
 */

import type { FieldMapping } from "../store/store/types";
import type { localStorageDriver as StoreLocalStorageDriver } from "../store/persist/drivers";
import type { useNotifier as StoreUseNotifier } from "../react/useNotifier";
import type { usePersist as StoreUsePersist } from "../react/usePersist";
import type { useTranslator as StoreUseTranslator } from "../react/useTranslator";
import type { useStoreContext as StoreUseStoreContext } from "../react/useStoreContext";
import type { defineList as StoreDefineList } from "../store/defineList";
import type { defineFlow as StoreDefineFlow, defineStep as StoreDefineStep } from "../store/flow/defineFlow";
import type { defineFieldMapping as StoreDefineFieldMapping } from "../store/defineFieldMapping";

import type { Palistor as PalistorStore, PalistorConstructor, UseForm } from "./types";
import { Palistor as CubePalistor } from "./palistor";
import { useForm as cubeUseForm } from "./react/useForm";
import { useStoreContext as cubeUseStoreContext } from "./react/useStoreContext";
import { useTranslator as cubeUseTranslator } from "./react/useTranslator";
import { useNotifier as cubeUseNotifier } from "./react/useNotifier";
import { usePersist as cubeUsePersist } from "./react/usePersist";
import { defineList as cubeDefineList } from "./defineList";
import { defineFlow as cubeDefineFlow, defineStep as cubeDefineStep } from "./defineFlow";
import { localStorageDriver as cubeLocalStorageDriver, sessionStorageDriver as cubeSessionStorageDriver } from "./core";

// ============================================================================
// Persist — drivers and types
// ============================================================================

export type { PersistDriver, PersistOptions } from "../store/persist/types";
export type { PersistManager } from "../store/persist/persistManager";

export const localStorageDriver: typeof StoreLocalStorageDriver = cubeLocalStorageDriver;
export const sessionStorageDriver: typeof StoreLocalStorageDriver = cubeSessionStorageDriver;

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
  FilterBlock,
  FilterFieldConfig,
  FilterProxyNode,
  PaginationConfig,
  PageMode,
  PageRequest,
  PagedResult,
  SortBlock,
  SortDirection,
  SortFieldConfig,
  SortKey,
  SortProxyNode,
  SortRequest,
} from "../store/store/types";
export type { Palistor as PalistorProxy } from "../store/store/types";
// Cube always passes `ctx.sort`; the store's own ListResolveContext keeps it optional (it builds the object without one).
export type { ListResolveContextWithSort as ListResolveContext } from "../store/store/types";

// The store's class type, extended: the constructor also takes the server-rendering
// options and instances have start(). Still assignable wherever the store's
// Palistor<TConfig, TMapping> or a ProxyStore is expected.
export const Palistor = CubePalistor as unknown as PalistorConstructor;
export type Palistor<
  TConfig extends Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  TMapping extends FieldMapping = {},
> = PalistorStore<TConfig, TMapping>;
export type { InitialData, PalistorOptions, PalistorProviderProps } from "./types";

// ============================================================================
// Resolve — types and hooks
// ============================================================================

export type { Resolve, NotifyFn, ResolveErrorContext, ResolveStatus } from "../store/resolvePipeline/";
export const useNotifier = cubeUseNotifier as unknown as typeof StoreUseNotifier;

// ============================================================================
// React hooks
// ============================================================================

/** The store's overloads plus a field, a list's sort node and a list's filter node handed down as a prop (cube/types.ts, `UseForm`). */
export const useForm = cubeUseForm as unknown as UseForm;
export const usePersist = cubeUsePersist as unknown as typeof StoreUsePersist;
export const useTranslator = cubeUseTranslator as unknown as typeof StoreUseTranslator;
export const useStoreContext = cubeUseStoreContext as unknown as typeof StoreUseStoreContext;

// Cube only: a store per component instance and the provider it is wired to
// (typed where they are written; the store has no counterpart to borrow from).
export { usePalistor } from "./react/usePalistor";
export { PalistorProvider, usePalistorContext } from "./react/provider";

// ============================================================================
// defineList — typed list helper
// ============================================================================

export const defineList = cubeDefineList as unknown as typeof StoreDefineList;

// ============================================================================
// defineFlow / defineStep — step-based flow primitive
// ============================================================================

export const defineFlow = cubeDefineFlow as unknown as typeof StoreDefineFlow;
export const defineStep = cubeDefineStep as unknown as typeof StoreDefineStep;
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

// An identity that keeps the map's literal types; the store applies the map (cube/core/mapping.ts).
export const defineFieldMapping: typeof StoreDefineFieldMapping = (mapping) => mapping;
