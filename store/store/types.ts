import type { PersistManager } from "../persist/persistManager";
import type { EntityNode } from "../entityRegistry/types";
import type { MappableKey, MappableConfigKey } from "../constants";
import type {
  AnyFlowStep,
  FlowError,
  FlowStep,
  FlowValues,
  InferFlowSteps,
  StepStatus,
} from "../flow/defineFlow";

/**
 * Internal type for recursively walking the config tree.
 * Used by registerNodes, buildProxy, applyPatch, recomputeAll, etc.
 */
export interface AnyConfigNode {
  [key: string]: AnyConfigNode | unknown;
}

/**
 * Translation function (next-intl, i18next, …).
 * label/placeholder/description in the config may be functions of TranslateFn.
 * Accepts any number of arguments — compatible with next-intl `t`, i18next `t`, etc.
 */
export type TranslateFn = (...args: any[]) => string;

/**
 * Form config type: an object where every key is a config node typed over TValues.
 */
export type FormConfig<TValues = Record<string, unknown>> = Record<string, ConfigNode<any, TValues>>;
import type { NotifyFn, Resolve, ResolveStatus } from "../resolvePipeline";
import type { SubmitResult } from "../submitPipeline/submitPipeline";

// ─── Utility types ───────────────────────────────────────────────────────────

/** Unsubscribe function returned by subscriptions. */
export type Unsubscribe = () => void;

/**
 * A value, or a function computing it from the current form values.
 * Most config properties (isVisible, isRequired, label, …) can be either a
 * static value or a function of the whole values tree.
 *
 * @example
 * // static
 * isVisible: true
 * // computed
 * isVisible: (values) => values.paymentType === "bank"
 */
export type MaybeComputed<TResult, TValues = Record<string, unknown>> =
  | TResult
  | ((values: TValues) => TResult);

/**
 * Used for label / placeholder / description, which can be:
 *   - a static string
 *   - `(t: TranslateFn, values: TValues) => string` — translation + computation
 */
export type MaybeTranslatable<TResult, TValues = Record<string, unknown>> =
  | TResult
  | ((t: TranslateFn, values: TValues) => TResult);

/**
 * Deeply optional version of the values.
 * Recurses only into "plain" objects; arrays, Date, Map, Set, etc.
 * are left as-is.
 */
export type DeepPartialValues<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K]
    : T[K] extends Date
      ? T[K]
      : T[K] extends Map<unknown, unknown>
        ? T[K]
        : T[K] extends Set<unknown>
          ? T[K]
          : T[K] extends Record<string, unknown>
            ? DeepPartialValues<T[K]>
            : T[K];
};

/**
 * Widens a value type to accept typical formatter "input" types.
 * Number fields accept string (an Input yields strings), booleans accept
 * string/number. Other types are left as-is.
 */
type ProxyValueType<T> = T extends number
  ? T | string
  : T extends boolean
    ? T | string | number
    : T;

// ─── Config types ────────────────────────────────────────────────────────────

/**
 * Field type metadata (for future type-based validation / codegen).
 */
export interface FieldTypeMeta {
  readonly dataType: "String" | "Number" | "Boolean" | "Date" | "Array" | "Object";
  readonly type: string;
}

export type { Setter } from "../writePipeline/writePipeline";

/**
 * Universal config node — describes both a field and a group.
 *
 * The node's behavior is determined by which properties are present:
 *   - Has `value` → leaf node (form field)
 *   - No `value`  → group node (container for children)
 *
 * All properties except `value` are optional.
 * Any computed property can be a constant or a function of `TValues`.
 *
 * @template TValue  — the field's value type (relevant for leaf nodes)
 * @template TValues — shape of the whole values tree (defaults to Record<string,any>)
 */
export interface ConfigNode<TValue = unknown, TValues = Record<string, unknown>> {
  // ─── Field (a node with `value` is considered a leaf) ──────────────────
  value?: MaybeComputed<TValue, TValues>;
  label?: MaybeTranslatable<string, TValues>;
  placeholder?: MaybeTranslatable<string, TValues>;
  description?: MaybeTranslatable<string, TValues>;
  /**
   * Returns an error string, or a falsy value when the field is valid.
   * `false` is allowed for the convenience of the `!v && "required"` pattern.
   */
  validate?: (value: TValue, values: TValues, t: TranslateFn) => string | undefined | false;
  /** Transforms the input value before storing it (e.g. trims whitespace). */
  formatter?: (value: string | boolean, values: TValues) => string | number | boolean;
  /** Write side-effect: returns a patch for other fields. */
  setter?: (value: TValue, values: TValues, previousValue: TValue | undefined) => DeepPartialValues<TValues>;
  /** Extra props for the UI component. */
  componentProps?: Readonly<Record<string, unknown>>;
  /** Field names whose changes trigger a recompute of this field's state. */
  dependencies?: readonly string[];
  /** Field type metadata. */
  types?: FieldTypeMeta;

  // ─── Shared flags (field and group) ────────────────────────────────────
  isRequired?: MaybeComputed<boolean, TValues>;
  isReadOnly?: MaybeComputed<boolean, TValues>;
  isDisabled?: MaybeComputed<boolean, TValues>;
  isVisible?: MaybeComputed<boolean, TValues>;

  // ─── Lifecycle (any node) ──────────────────────────────────────────────
  /**
   * Transforms the value before submit (does not mutate the store).
   * On a leaf node:  `(value, values) → value`
   * On a group node: `(values) → values`
   */
  beforeSubmit?: ((value: TValue, values: TValues) => TValue) | ((values: TValues) => TValues);
  /** Form submit callback. Invoked after validation in the submit pipeline. */
  onSubmit?: (
    value: TValue | TValues,
    store: ProxyStore<any>,
    parent?: any,
  ) => Promise<unknown> | unknown;
  /** Post-processing after a successful onSubmit. */
  afterSubmit?: (
    result: unknown,
    actions: { reset: () => void },
  ) => void | Promise<void>;
  /** Reset transformer: receives defaults, returns the final values. */
  reset?: (defaults: TValues) => TValues;
  /**
   * Called after any field in the group changes (fire-and-forget).
   * May return a patch to merge back into the store.
   */
  onChange?: (info: {
    fieldKey: string;
    newValue: unknown;
    previousValue: unknown;
    allValues: TValues;
  }) => DeepPartialValues<TValues> | void | Promise<DeepPartialValues<TValues> | void>;
  /**
   * Per-entity field resolver (only valid inside a list template).
   * resolver receives the entity's current values and returns the new field value.
   * Triggered automatically after the list resolver completes, or lazily on first
   * access to field.value / field.loading.
   */
  resolve?: Resolve<TValue>;
}

// ─── Proxy types ─────────────────────────────────────────────────────────────

/**
 * Config keys that are not child fields (hidden when mapping over a group node).
 */
type ConfigSkipKeys =
  | "value"
  | "label"
  | "placeholder"
  | "description"
  | "validate"
  | "formatter"
  | "setter"
  | "isRequired"
  | "isReadOnly"
  | "isDisabled"
  | "isVisible"
  | "isInvalid"
  | "errorMessage"
  | "componentProps"
  | "types"
  | "dependencies"
  | "onSubmit"
  | "beforeSubmit"
  | "afterSubmit"
  | "reset"
  | "onChange"
  | "resolve"
  | "deps"

/**
 * Shape of a leaf field as seen through the proxy.
 * All functions (isVisible, validate, …) are already evaluated.
 */
export interface FieldProxyNode<TValue = unknown> {
  /** Reads return the typed value; writes accept a widened type (string for number fields, etc.). */
  get value(): TValue;
  set value(v: ProxyValueType<TValue>);
  readonly label: string | undefined;
  readonly placeholder: string | undefined;
  readonly description: string | undefined;
  readonly isRequired: boolean;
  readonly isReadOnly: boolean;
  readonly isDisabled: boolean;
  readonly isVisible: boolean;
  /** true when the field has a validation error. */
  readonly isInvalid: boolean | undefined;
  readonly errorMessage: string | undefined;
  /** true when the current value differs from the initial one. */
  readonly dirty: boolean;
  /*
    You can use this callback or assign directly (field.value = v). The
    callback is the default way; direct assignment is for special cases.
  */
  readonly onValueChange: (v: ProxyValueType<TValue>) => void;
  /** true while the submit pipeline is running (same as GroupProxyNode). */
  readonly submitting: boolean;
  /** Submit pipeline: submitting → beforeSubmit → validate → onSubmit → afterSubmit. */
  submit(): Promise<SubmitResult>;
}

/** Extracts the value type from a config node. */
type ExtractNodeValue<T> = T extends { value: (...args: any[]) => infer R }
  ? R
  : T extends { value: infer V }
    ? V
    : never;

/**
 * Computed flags of a group node (present when set in the config;
 * may be a boolean constant or a function — already resolved in the proxy).
 */
export interface GroupProxyNode {
  readonly isVisible: boolean;
  readonly isRequired: boolean | undefined;
  readonly isReadOnly: boolean | undefined;
  readonly isDisabled: boolean | undefined;
  readonly isInvalid: boolean | undefined;
  readonly errorMessage: string | undefined;
  /** true while the submit pipeline is running. */
  readonly submitting: boolean;
  /** true while async resolver is loading (only for nodes with resolve). */
  readonly loading: boolean;
  /** true when at least one field in the group differs from its initial value. */
  readonly dirty: boolean;
  /**
   * true after the first failed submit — errors are shown in real time.
   * false before the first submit — errors are hidden.
   */
  readonly revalidate: boolean;
  /** Current values of all leaf fields in the subtree as a nested object. Live reference (not a clone). */
  readonly values: Record<string, unknown>;
  /** Submit pipeline: submitting → beforeSubmit → validate → onSubmit → afterSubmit. */
  submit(): Promise<SubmitResult>;
  /** Resets the subtree to config defaults (or to the provided values). */
  reset(values?: Record<string, unknown>): void;
  /**
   * Bulk value update: applies a patch to the subtree in a single recompute + notify.
   * Skips setters (to avoid recursion) and formatters.
   * Used for feeding in server data or bulk changes from React.
   */
  setValues(patch: Record<string, unknown>): void;
}

// ─── List types ──────────────────────────────────────────────────────────────

/**
 * Context object passed as the THIRD resolver argument — shared with the
 * pagination plan (two plans cannot each own arg 3). Passed ALWAYS (never
 * `undefined`): a list with no filter block gets `filter.values = {}` /
 * `filter.params = undefined`, so a resolver never needs an existence check.
 *
 * `values` (arg 1) keeps its meaning — form values with `$filters` stripped;
 * the filter is reachable only through `ctx`.
 */
export interface ListResolveContext {
  filter: {
    /** Full non-derived-included snapshot of the filter's own values (server AND client fields). */
    values: Record<string, unknown>;
    /** Built from SERVER fields only (per-field `param` renames, or `$toParams`). */
    params: unknown;
    /** The serverKey — the request identity. */
    key: string;
  };
  /** Reserved seam — PaginationPlan (PageRequest). */
  page?: unknown;
  /** Reserved seam — the future `sort` block. */
  sort?: unknown;
  queryKey: string;
  /** Reserved seam — resolver cancellation. */
  signal?: AbortSignal;
}

/**
 * One field of a list's `filter` block, in the full leaf vocabulary plus three
 * filter-specific keys. The 90% case is the literal shorthand instead
 * (`filter: { search: "" }` — a non-config default expands to `{ value: literal }`).
 */
export type FilterFieldConfig<TEntity = Record<string, unknown>> = ConfigNode<any, any> & {
  /**
   * Client predicate: keep `item` iff it returns true. Declaring `where` makes
   * this a CLIENT field: excluded from serverKey, params and resolver deps.
   * Skipped automatically while the field's value is empty.
   */
  where?: (item: TEntity, value: any) => boolean;
  /** Server param name for this field's value (default: the field key). */
  param?: string;
  /** ms to debounce the INVALIDATION this field's changes cause (never the value). */
  debounce?: number;
};

/**
 * A list's `filter` block: fields (literal defaults or {@link FilterFieldConfig})
 * plus `$`-prefixed block-level options — in a filter block, a `$` key is block
 * config, everything else is a field.
 */
export type FilterBlock<TEntity = Record<string, unknown>> = {
  [field: string]: unknown;
} & {
  /** Cross-field client rule, ANDed after the per-field `where`s. Always runs. */
  $all?: (item: TEntity, filterValues: Record<string, unknown>) => boolean;
  /** Escape hatch: shape ALL server params at once (overrides per-field `param`). */
  $toParams?: (filterValues: Record<string, unknown>, context: Record<string, unknown>) => unknown;
  /** Persist filter values (opt-in — filters are view state). Default false. Phase 2. */
  $persist?: boolean;
};

/**
 * The `list.filter` proxy: CONTROLS only — no list row is ever reachable here
 * (rows are read from the list: `list.values` / `list.length`). Field keys are
 * full field proxies bindable to inputs, exactly like `form.name`.
 */
export interface FilterProxyNode {
  /** Plain snapshot of the FILTER's own values (derived fields included) — never list rows. */
  readonly values: Record<string, unknown>;
  /** Bulk write; one notify, one invalidation (flushes any pending debounce). */
  readonly set: (patch: Record<string, unknown>) => void;
  /** Back to declared defaults. */
  readonly reset: () => void;
  /** Clear one field (or all) to its EMPTY value, not its default. */
  readonly clear: (field?: string) => void;
  /** Any non-derived field is non-empty — replaces hand-written hasActiveFilters. */
  readonly isActive: boolean;
  /** How many such fields — the badge on a "Filters" button. */
  readonly activeCount: number;
  /** A debounced invalidation is queued but not yet issued. */
  readonly isPending: boolean;
  /** Filter field proxies by the author's field names. */
  readonly [field: string]: any;
}

/**
 * Resolver configuration for a ListNode (like Resolve for a group, but returns
 * an array of entity records). Minimal interface that avoids importing Resolve
 * from resolvePipeline (prevents circular dependencies).
 */
export interface ListResolveConfig {
  /**
   * Async data loader — returns array of entity records.
   * `ctx` carries the filter snapshot/params/key (and, later, page/sort) — see
   * {@link ListResolveContext}. Two-argument resolvers keep working unchanged.
   */
  resolver: (
    values: any,
    store: ProxyStore<any>,
    ctx: ListResolveContext,
  ) => Promise<Array<Record<string, unknown>>>;
  /**
   * Error handler called when resolver throws.
   * ctx.notify — notification function from useNotifier.
   */
  onError?: (error: unknown, ctx: { notify: (...args: any[]) => void }) => void;
  /** Explicit dependency paths — re-trigger resolver when these paths change. */
  deps?: string[];
  options?: {
    /** Wait for first access to the list. Default: true */
    lazy?: boolean;
    /** Throw Promise for React Suspense. Default: false */
    suspense?: boolean;
  };
}

/**
 * List-level configuration (second element of a ListNode array).
 * The resolver and other list-level options go here.
 */
export interface ListConfig {
  resolve?: ListResolveConfig;
  /**
   * Declared filter block — top-level, NOT inside `resolve`: a list with no
   * resolver can still be filtered client-side (an all-`where` block).
   */
  filter?: FilterBlock<any>;
}

/**
 * Internal list state — the SINGLE "list" building block (root + per-entity).
 *
 * Node identity for tracking/resolve is the `ListState` object itself (hub
 * key), not a separate version field. A root list is the degenerate case
 * `ownerEntity === null`; a per-entity list points to its owner.
 *
 * Root `ListState` lives in `NodeRegistry.listStates` (keyed by `listConfigNode`),
 * per-entity ones live in `owner.lists` (same `listConfigNode` key).
 */
export interface ListState {
  /** The array config node [template, listConfig?] — key in all registries. */
  listConfigNode: object;
  /** Item template — describes the fields to render. listConfigNode[0]. */
  template: object;
  /** List configuration (resolve etc.). listConfigNode[1] — optional. */
  listConfig?: ListConfig;
  /** List owner. `null` = root list; otherwise the owning entity. */
  ownerEntity: EntityNode | null;
  /** IDs of the entities in the list (in display order). */
  itemIds: string[];
  /** Captured at init/resolve — used for membership dirty-tracking. */
  initialItemIds: string[];
  /**
   * Optional filter sidecar (root lists with a `filter` block only).
   * Mutated in place — the ListState identity is never recreated.
   */
  filter?: import("../filtering/types").FilterState;
}

/**
 * Proxy interface for a list (ListNode in the config).
 * TItem — type of a single item (EntityProjectionProxy).
 */
export interface ListProxyNode<TItem> {
  readonly items: ReadonlyArray<TItem>;
  readonly length: number;
  /**
   * Filter controls (lists with a `filter` block only). Rows never appear
   * here — `list.filter` carries controls, the list carries data.
   */
  readonly filter?: FilterProxyNode;
  /**
   * VISIBLE item proxies — the render entry point under an active client
   * filter (an alias of `items`, and what `map` iterates). Present only on a
   * list with a `filter` block.
   */
  readonly values?: ReadonlyArray<TItem>;
  /** Size of the FULL loaded membership (`length` is the visible set). */
  readonly fullLength?: number;
  readonly loading: boolean;
  /** true when list membership changed since init/last resolve. */
  readonly dirty: boolean;
  /**
   * Error thrown by the last list resolve; `null` on success or before any run.
   * Stays `unknown` — a resolver can throw anything, normalization is the
   * consumer's job.
   */
  readonly error: unknown | null;
  /** Raw resolve status: "idle" | "pending" | "resolved" | "error". */
  readonly resolveStatus: ResolveStatus;
  /** Force a resolver re-run, ignoring the resolved-state dedup. No-op without a resolver. */
  reload(): void;
  add(id: string): void;
  add(values: Record<string, unknown>): TItem;
  remove(id: string): void;
  getById(id: string): TItem | undefined;
  setItems(ids: string[]): void;
  map<R>(fn: (item: TItem, index: number, id: string) => R): R[];
  getValues(): Array<Record<string, unknown>>;
  [Symbol.iterator](): Iterator<TItem>;
}

// ─── Typed References ────────────────────────────────────────────────────────

declare const __palistorRefBrand: unique symbol;
declare const __typedListBrand: unique symbol;

/** Opaque reference to an entity proxy. Passed as a prop, unwrapped via useForm(). */
export type PalistorRef<T extends Record<string, any>> = {
  readonly [__palistorRefBrand]: T;
} & object;

/** Typed entity list. */
export type PalistorList<T extends Record<string, any>> = ListProxyNode<PalistorRef<T>>;

/** Marker type for a typed list node in the config. */
export type TypedListNode<TEntity extends Record<string, any>> =
  readonly [any, any?] & { readonly [__typedListBrand]: TEntity };

/** Typed list resolver. */
export type ListResolver<TEntity extends Record<string, any>> =
  (values: any, store: ProxyStore<any>, ctx: ListResolveContext) => Promise<TEntity[]>;

/** Typed template: each Entity key → ConfigNode with the matching value type. */
export type TemplateConfig<TEntity extends Record<string, any>> = {
  [K in keyof TEntity]: ConfigNode<TEntity[K], TEntity>;
};

/** Extract the entity type from a PalistorRef. */
export type InferEntity<T> = T extends PalistorRef<infer E> ? E : never;

// ─── Flow proxy types (defineFlow) ───────────────────────────────────────────

/**
 * Proxy of a single flow step: the step config's regular group proxy,
 * enriched with the computed `status` (see {@link StepStatus}).
 */
export type FlowStepProxy<C, M extends FieldMapping = {}> =
  ConfigNodeToProxy<C, M> & { readonly status: StepStatus };

/**
 * Proxy of the step collection (flow.steps): access by index (tuple), by key,
 * plus a live `.current` reference to the active step's proxy.
 */
export type FlowStepsProxy<S extends readonly AnyFlowStep[], M extends FieldMapping = {}> =
  { readonly [I in keyof S]: S[I] extends FlowStep<any, infer C> ? FlowStepProxy<C, M> : never } &
  { readonly [Step in S[number] as Step["key"]]: FlowStepProxy<Step["config"], M> } & {
    /** Proxy of the active step — replaced on every navigation. */
    readonly current: FlowStepProxy<S[number]["config"], M>;
  };

/**
 * Proxy of a flow node (defineFlow): group proxy + navigation state and methods.
 */
export type FlowProxyNode<S extends readonly AnyFlowStep[], M extends FieldMapping = {}> =
  Omit<ApplyFieldMapping<GroupProxyNode, M>, "values"> & {
    /** Key of the active step (reactive). */
    readonly currentStepKey: S[number]["key"];
    /** Index of the active step (reactive). */
    readonly currentStepIndex: number;
    /** true when the visit stack is non-empty (reliable guard for a Back button). */
    readonly canGoBack: boolean;
    /** Visit path: [...visitStack, currentStepKey] (reactive). */
    readonly history: readonly string[];
    /** Errors from the last validate()/finalization (reactive). */
    readonly errors: ReadonlyArray<FlowError>;
    /** Step collection: steps[0], steps.key, steps.current, steps.length. */
    readonly steps: FlowStepsProxy<S, M>;
    /** Accumulated values of all steps — live reference (like a group's). */
    readonly values: FlowValues<S>;
    /** Advance to the next VISIBLE step; if none remain — finalize via submit(). */
    nextStep(): void;
    /** Go back along the visit stack. No-op when the stack is empty. */
    back(): void;
    /** Jump to a step by key or index. Throws on an unknown key/index. */
    goTo(keyOrIndex: S[number]["key"] | number): void;
    /** Validate visited steps → errors land in flow.errors. Empty array = valid. */
    validate(): FlowError[];
  };

/**
 * Recursively converts a config node into its proxy type:
 * - FlowNode (defineFlow)                       → `FlowProxyNode<S>`
 * - TypedListNode (defineList<TEntity>)         → `ListProxyNode<PalistorRef<TEntity>>`
 * - ListNode (array `[template, listConfig?]`)  → `ListProxyNode<...>`
 * - Leaf node (has `value`)                     → `FieldProxyNode<TValue>`
 * - Group node                                  → `GroupProxyNode & { child fields… }`
 */
type ConfigNodeToProxy<T, M extends FieldMapping = {}> =
  [InferFlowSteps<T>] extends [never]
    ? T extends { readonly [__typedListBrand]: infer TEntity extends Record<string, any> }
      ? ApplyFieldMapping<ListProxyNode<PalistorRef<TEntity>>, M>
      : T extends readonly [infer Item, ...any[]]
        ? ApplyFieldMapping<ListProxyNode<ConfigNodeToProxy<Item, M>>, M>
        : T extends { value: any }
          ? ApplyFieldMapping<FieldProxyNode<ExtractNodeValue<T>>, M>
          : T extends Record<string, any>
            ? ApplyFieldMapping<GroupProxyNode, M> & {
                [K in keyof T as K extends ConfigSkipKeys ? never : K]: ConfigNodeToProxy<T[K], M>;
              }
            : never
    : FlowProxyNode<InferFlowSteps<T>, M>;

/**
 * Full proxy for a form config: every key maps to a proxy node.
 * The root proxy also includes GroupProxyNode (submit, reset, setValues, dirty, …).
 *
 * `M` is the field rename map (see {@link FieldMapping}). Defaults to `{}`
 * (identity: property names are unchanged).
 */
export type ConfigProxy<TConfig extends Record<string, any>, M extends FieldMapping = {}> =
  ApplyFieldMapping<GroupProxyNode, M> & {
    [K in keyof TConfig]: ConfigNodeToProxy<TConfig[K], M>;
  };

// ─── Raw-store brand ────────────────────────────────────────────────────────
//
// `store.proxy` (and every subtree of it) is branded with a unique symbol so
// TypeScript can tell the "raw" store proxy apart from the tracking proxy
// returned by `useForm()`. The brand propagates recursively through every
// node — group, leaf, list — so `store.proxy.foo.bar.baz` also carries
// `RawStoreProxyMarker`.
//
// This makes an accidental call like
//   useForm(store.proxy.someGroup)
// a compile-time error (see the `useForm` overloads).

declare const __rawStoreBrand: unique symbol;

/**
 * Marker of a "raw" node from `store.proxy`. Do not pass such values to
 * `useForm()` — call `useForm(store)` and access subtrees through the
 * returned tracking proxy.
 */
export interface RawStoreProxyMarker {
  readonly [__rawStoreBrand]: "Do not pass store.proxy or store.proxy.subtree to useForm. Use: const form = useForm(store); then form.subtree";
}

/**
 * Same recursive config→proxy conversion as `ConfigNodeToProxy`, but every
 * level (group / leaf / list) is intersected with `RawStoreProxyMarker` so
 * the brand propagates through the whole tree.
 */
type ConfigNodeToProxyRaw<T, M extends FieldMapping = {}> =
  [InferFlowSteps<T>] extends [never]
    ? T extends { readonly [__typedListBrand]: infer TEntity extends Record<string, any> }
      ? ApplyFieldMapping<ListProxyNode<PalistorRef<TEntity>>, M> & RawStoreProxyMarker
      : T extends readonly [infer Item, ...any[]]
        ? ApplyFieldMapping<ListProxyNode<ConfigNodeToProxyRaw<Item, M>>, M> & RawStoreProxyMarker
        : T extends { value: any }
          ? ApplyFieldMapping<FieldProxyNode<ExtractNodeValue<T>>, M> & RawStoreProxyMarker
          : T extends Record<string, any>
            ? ApplyFieldMapping<GroupProxyNode, M> & RawStoreProxyMarker & {
                [K in keyof T as K extends ConfigSkipKeys ? never : K]: ConfigNodeToProxyRaw<T[K], M>;
              }
            : never
    : FlowProxyNode<InferFlowSteps<T>, M> & RawStoreProxyMarker;

/**
 * Type of `store.proxy`. Structurally identical to `ConfigProxy<TConfig>`,
 * but every node of the tree carries {@link RawStoreProxyMarker} — which
 * lets TypeScript reject `useForm(store.proxy.X)`.
 *
 * Passing such a value (or its subtree) into `useForm` produces an error like:
 *   Argument of type 'X' is not assignable to parameter of type
 *   '_PALISTOR_ERROR__do_not_pass_store_proxy_subtree_to_useForm__call_useForm_store_first'.
 */
export type RawStoreProxy<TConfig extends Record<string, any>, M extends FieldMapping = {}> =
  ApplyFieldMapping<GroupProxyNode, M> & RawStoreProxyMarker & {
    [K in keyof TConfig]: ConfigNodeToProxyRaw<TConfig[K], M>;
  };

/**
 * Proxy for a single entity: id is exposed as string,
 * remaining fields follow the Palistor<T> rules.
 */
export type PalistorEntityProxy<T extends { id?: any }> = GroupProxyNode & {
  readonly id: string;
} & {
  [K in Exclude<keyof T, "id">]: T[K] extends Record<string, any>
    ? Palistor<T[K]>
    : FieldProxyNode<T[K]>;
};

/**
 * Maps a form-values interface onto proxy types.
 * Unlike ConfigProxy (which works with config nodes), Palistor takes a plain
 * values interface — convenient for typing props of child components that
 * receive a subtree from useForm.
 *
 * **Note:** the package exports this type as `PalistorProxy`, because the
 * name `Palistor` is taken by the class of the same name.
 * Use `import type { PalistorProxy } from "palistor"`.
 *
 * @example
 * ```ts
 * import type { PalistorProxy } from "palistor";
 *
 * interface CompanyFormData {
 *   name: string;
 *   email: string;
 *   bank: { name: string; number: string };
 * }
 * type Props = { company: PalistorProxy<CompanyFormData> };
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type Palistor<T extends Record<string, any> = {}, M extends FieldMapping = {}> =
  ApplyFieldMapping<GroupProxyNode, M> & {
    [K in keyof T]: T[K] extends Array<infer Item>
      ? Item extends Record<string, any>
        ? ApplyFieldMapping<ListProxyNode<Palistor<Item, M>>, M>
        : ApplyFieldMapping<ListProxyNode<FieldProxyNode<Item>>, M>
      : T[K] extends Record<string, any>
        ? Palistor<T[K], M>
        : ApplyFieldMapping<FieldProxyNode<T[K]>, M>;
  };

/**
 * Recursively extracts value types from a form config.
 * Leaf nodes (containing `value`) → the value type.
 * Group nodes → a nested object with the same rules.
 * Service keys (validate, formatter, …) are skipped.
 */
export type ExtractValues<T> = {
  [K in keyof T as K extends ConfigSkipKeys ? never : K]: [InferFlowSteps<T[K]>] extends [never]
    ? T[K] extends readonly [infer Item, ...any[]]
      ? Array<ExtractValues<Item>>
      : T[K] extends { value: any }
        ? ExtractNodeValue<T[K]>
        : T[K] extends Record<string, any>
          ? ExtractValues<T[K]>
          : never
    : FlowValues<InferFlowSteps<T[K]>>;
};

// ─── Store interfaces ────────────────────────────────────────────────────────

/**
 * internal → external rename map for projecting field names through the proxy.
 *
 * Sparse: list only the keys you rename; the rest keep their original names.
 * Applied at the proxy boundary (GET/SET/ownKeys/spread) and in the tracking
 * proxy; internal logic (FieldState, compute, pipelines) is unchanged.
 *
 * **Invariant:** the map is a bijection. An external name must not collide
 * with a sibling child-field name and must not point at two different
 * internal keys.
 *
 * @example
 * fieldMapping: {
 *   isRequired:   'required',
 *   isInvalid:    'error',
 *   errorMessage: 'helperText',
 * }
 */
export type FieldMapping = Partial<Record<MappableKey, string>>;

/**
 * Applies the rename map `M` (internal → external) to a proxy node type `T`:
 * every key `K` present in `M` is renamed to `M[K]`; the rest are unchanged.
 * Modifiers (`readonly`, the `value` getter/setter) are preserved.
 *
 * An empty map (`{}`) → identity: the original `T` is returned without
 * remapping, so the default behavior matches the pre-mapping one exactly
 * (zero overhead).
 */
export type ApplyFieldMapping<T, M extends FieldMapping> =
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  keyof M extends never
    ? T
    : {
        [K in keyof T as K extends keyof M ? (M[K] extends string ? M[K] : K) : K]: T[K];
      };

// ─── External-config validator (compile-time strict, no helper) ──────────────

declare const CONFIG_KEY_ERROR: unique symbol;
/** Branded error type: makes the property unassignable and surfaces the hint
 *  text in the compiler message. */
export type ConfigKeyError<Msg extends string> = { readonly [CONFIG_KEY_ERROR]: Msg };

/** Internal config key names actively renamed by the map `M`. */
type RemappedInternalConfigKey<M extends FieldMapping> = keyof M & MappableConfigKey;

/**
 * Checks the config tree `T` against the map `M`: any node containing the
 * INTERNAL name of a remapped config key (`isRequired` when `isRequired→required`)
 * gets a {@link ConfigKeyError} on that key → the assignment fails with a
 * readable message. Empty map → `unknown` (intersection identity, zero overhead).
 *
 * Intersected with `TConfig` in the `config` option, so valid keys keep their
 * original type (`T[K] & unknown`) while offending ones become unassignable.
 */
export type ValidateExternalConfig<T, M extends FieldMapping> =
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  keyof M extends never
    ? unknown
    : T extends object
      ? {
          [K in keyof T]: K extends RemappedInternalConfigKey<M>
            ? ConfigKeyError<`palistor: write "${M[K] & string}" instead of internal "${K & string}" — fieldMapping is active`>
            : ValidateExternalConfig<T[K], M>;
        }
      : unknown;

/**
 * Config node type in the SINGLE public vocabulary of the map `M` (external
 * names). Optional: annotate a config node/constant with this type to get
 * autocomplete for external names (`required`, `helpText`, …). Strictness
 * does not require the annotation — the validator on `config` already
 * catches internal names.
 */
export type ExternalConfigNode<
  M extends FieldMapping,
  TValue = unknown,
  TValues = Record<string, unknown>,
> = ApplyFieldMapping<ConfigNode<TValue, TValues>, M>;

/**
 * Form config type in the external names of the map `M` (like {@link FormConfig},
 * but with renamed field-state keys). For OPTIONAL annotation, purely for
 * external-name autocomplete.
 *
 * ⚠️ Trade-off: this is a `Record<string, …>` (like {@link FormConfig}), so
 * the annotation widens the literal type and `ExtractValues`/`initialValues`
 * typing lose precision. The recommended path is to **not annotate**: the
 * validator on the `config` option (see {@link ValidateExternalConfig})
 * already catches internal names, while precise value inference from the
 * literal is preserved. Use the annotation only where precise `ExtractValues`
 * is not needed.
 */
export type ExternalConfig<
  M extends FieldMapping,
  TValues = Record<string, unknown>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
> = Record<string, ExternalConfigNode<M, any, TValues>>;

export interface ProxyStoreOptions<
  TConfig extends Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  TMapping extends FieldMapping = {},
> {
  /**
   * Declarative description of the form structure and fields. Never mutated.
   *
   * When `fieldMapping` is active, the config is written in the map's SINGLE
   * public vocabulary (external names: `required`, `helpText`, …). The
   * intersection with {@link ValidateExternalConfig} catches internal names
   * (`isRequired`, …) as a type error with a hint. `NoInfer` prevents
   * `TMapping` from leaking out of the config — the map is inferred from
   * `fieldMapping` only.
   */
  config: TConfig & ValidateExternalConfig<TConfig, NoInfer<TMapping>>;
  /**
   * Initial values that override the defaults from the config.
   * Mirrors the config structure, but all fields are optional.
   */
  initialValues?: DeepPartialValues<ExtractValues<TConfig>>;
  /**
   * Initial context. When provided, eager resolvers see it on their first run.
   * Equivalent to calling `setContext()` before `launchEager()`.
   */
  context?: Record<string, unknown>;
  /**
   * Optional internal → external rename map. Defines the names under which
   * internal field properties are visible through the proxy (GET + ownKeys/
   * spread + tracking). When omitted, behavior and performance are unchanged.
   *
   * The map's literal type is captured (via the Palistor class `const` type
   * parameter) and threaded into the `store.proxy` / `useForm(store)` types,
   * so renamed names are statically typed — no `as any`.
   *
   * @see FieldMapping
   */
  fieldMapping?: TMapping;
}

export interface ProxyStore<
  TConfig extends Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  TMapping extends FieldMapping = {},
> {
  /**
   * @internal Reverse rename map, external → internal (sparse).
   * Used on proxy input (GET/SET/tracking): an incoming external key is
   * translated to internal in one lookup. Empty when `fieldMapping` is unset.
   */
  readonly externalToInternal: Record<string, string>;

  /**
   * Reactive proxy. Mirrors the config structure.
   * GET .value / .isVisible / … → from the computed FieldState
   * SET .value = X → formatter → validate → recompute → notify
   *
   * Property names are projected according to `TMapping` (see {@link FieldMapping}).
   *
   * The type carries {@link RawStoreProxyMarker} — this node and all of its
   * subtrees must **not** be passed to `useForm()` (neither root nor subtree).
   * To subscribe in React, use `useForm(store)` and access fields through the
   * returned tracking proxy.
   */
  proxy: RawStoreProxy<TConfig, TMapping>;

  /**
   * Non-reactive context — arbitrary data available in all callbacks
   * (resolve.resolver, onSubmit, onChange, …) via `store.context`.
   *
   * Set via `setContext()` or the `useStoreContext()` hook.
   * Not part of the form — excluded from getValues(), submit, persist.
   *
   * @example
   * store.context.accountId; // read
   */
  readonly context: Record<string, unknown>;

  /**
   * Sets the non-reactive context. Replaces the current context wholesale.
   * Called from React (useStoreContext) or imperatively.
   *
   * @example
   * store.setContext({ accountId: "abc", tenant: "acme" });
   */
  setContext(ctx: Record<string, unknown>): void;

  /**
   * Subscribes to state changes of a specific config node.
   * Returns an unsubscribe function.
   */
  subscribe: (node: object, listener: () => void) => Unsubscribe;

  /**
   * Subscribes to ANY store change.
   * Used by useForm for useSyncExternalStore.
   * Returns an unsubscribe function.
   */
  subscribeGlobal: (listener: () => void) => Unsubscribe;

  /**
   * Global store version. Incremented on every change.
   * Used as the snapshot for useSyncExternalStore.
   */
  getVersion: () => number;

  /**
   * Version of a specific node. Bumped when the node's state changes.
   * Used for targeted subscriptions (re-render only on fields actually read).
   */
  getNodeVersion: (node: object) => number;

  /**
   * All current field values as a nested object.
   */
  getValues: () => ExtractValues<TConfig>;

  /**
   * Registers a translation function (next-intl, i18next, …) for resolving
   * label / placeholder / description.
   *
   * When the translator changes, all subscribed components re-render with
   * up-to-date translations.
   *
   * @param t — translation function, or null to clear
   */
  setTranslator: (t: TranslateFn | null) => void;

  /**
   * Persistence manager — hydration and auto-saving of form state.
   */
  persist: PersistManager;

  /**
   * Registers a notification function (toast, alert, …) for resolver onError.
   *
   * @param fn — notification function, or null to clear
   */
  setNotifier: (fn: NotifyFn | null) => void;

  /**
   * Submit root form.
   * Lifecycle: submitting → beforeSubmit → validate → onSubmit → afterSubmit.
   */
  submit(): Promise<SubmitResult>;

  /**
   * Resets the root form to config defaults (or to the provided values).
   */
  reset(values?: DeepPartialValues<ExtractValues<TConfig>>): void;
  /**
   * Bulk value update: applies a patch to the whole store in a single recompute + notify.
   * Skips setters (to avoid recursion) and formatters.
   * Used for feeding in server data or bulk changes from React.
   */
  setValues(patch: DeepPartialValues<ExtractValues<TConfig>>): void;

  /**
   * Creates or updates an entity (or an array of entities) in the registry.
   * - If no entity with the id exists — it is created and its leaf nodes registered.
   * - If it exists — recursive merge; changed leaf nodes are notified.
   * - Batch mode: an array is processed in one recompute + notifyChanged.
   */
  set(data: import("../entityRegistry").EntityData | import("../entityRegistry").EntityData[]): void;

  /**
   * Deletes an entity from the registry by ID.
   * Clears leaf nodes, bindings and resolvedCache. Notifies subscribers.
   * No-op when the entity does not exist.
   */
  delete(id: string): void;
}
