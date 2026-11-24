/**
 * Public types Cube adds on top of the store's (experiments/SsrPlan.md): the
 * constructor options of the server-rendering work, the store instance with
 * `start()`, and `InitialData`. Everything else in the public surface is still
 * typed by store/ (see cube/index.ts); store/ itself is not edited.
 */

import type { ReactNode } from "react";
import type { Palistor as StorePalistor } from "../store/store";
import type {
  ExtractValues,
  FieldMapping,
  PagedResult,
  ProxyStoreOptions,
  TranslateFn,
  TypedListNode,
} from "../store/store/types";
import type { NotifyFn } from "../store/resolvePipeline/";
import type { InferFlowSteps } from "../store/flow/defineFlow";
import type { FieldProxyNode, FilterProxyNode, RawStoreProxyMarker, SortProxyNode } from "../store/store/types";
import type {
  useForm as StoreUseForm,
  _PALISTOR_ERROR__do_not_pass_store_proxy_subtree_to_useForm__call_useForm_store_first as RawNodeError,
} from "../react/useForm";

// ─── initialData ─────────────────────────────────────────────────────────────

type IsAny<T> = 0 extends 1 & T ? true : false;

/** A list in `initialData`: its rows, or its first page the way a paginated resolver returns it. */
type InitialList<TRow> = TRow[] | PagedResult<TRow>;

/** Rows carry the entity id whether or not the template declares an `id` leaf (the registry keys them by `String(id)`). */
type WithRowId<TRow, TSource> = "id" extends keyof TSource ? TRow : TRow & { id?: string | number };

/** The value type of a leaf config node, exactly as `ExtractValues` (and so `getValues()`) types it. */
type LeafValue<TNode> = ExtractValues<{ leaf: TNode }>["leaf"];

/**
 * A row of a `defineList<TEntity>` list: any subset of the entity's keys. The
 * entity type does not say which of its keys the template declares as nested
 * lists, so a key holding an array of objects accepts both what the entity
 * type says and the list forms (partial rows, a first page).
 */
type InitialRow<TEntity> = WithRowId<{ [K in keyof TEntity]?: InitialRowValue<TEntity[K]> }, TEntity>;

type InitialRowValue<TValue> = TValue extends ReadonlyArray<infer TItem>
  ? TItem extends Record<string, any>
    ? TValue | InitialList<InitialRow<TItem>>
    : TValue
  : TValue;

/** A row of an inline `[template, listConfig?]` list: the template's own `initialData`. */
type InitialTemplateRow<TTemplate> = WithRowId<InitialData<TTemplate>, TTemplate>;

/**
 * One config node → what `initialData` accepts for it. Same case order as
 * `ExtractValues`, plus one case: an inline list written without `as const`
 * is inferred as an array of its template, not as a tuple.
 */
type InitialNode<TNode> = IsAny<TNode> extends true
  ? any
  : [InferFlowSteps<TNode>] extends [never]
    ? TNode extends TypedListNode<infer TEntity>
      ? InitialList<InitialRow<TEntity>>
      : TNode extends readonly [infer TTemplate, ...any[]]
        ? InitialList<InitialTemplateRow<TTemplate>>
        : TNode extends ReadonlyArray<infer TTemplate>
          ? InitialList<InitialTemplateRow<TTemplate>>
          : TNode extends { value: any }
            ? LeafValue<TNode>
            : TNode extends Record<string, any>
              ? InitialData<TNode>
              : never
    : { [Step in InferFlowSteps<TNode>[number] as Step["key"]]?: InitialData<Step["config"]> };

/**
 * The `initialData` constructor option for a config: results the server
 * already has, in the shape of `store.getValues()` with every key optional.
 *
 * - leaf → its value (exactly the value type; a key that is absent is not touched);
 * - group, flow step → the same rule for its children;
 * - list (`defineList` or `[template, listConfig?]`) → an array of rows, or
 *   the first page as a paginated resolver returns it
 *   (`{ items, total?, nextCursor?, hasMore? }`, see {@link PagedResult}).
 *   A row is partial too, and a nested list inside a row follows the same rule.
 *
 * The type does not know whether a list is paginated: both list forms are
 * accepted everywhere. With `config: x as any` it is `Record<string, any>`.
 *
 * @example
 * ```ts
 * const config = { search: { value: "" }, customers: defineList<Customer>({ template, resolve }) };
 * const data: InitialData<typeof config> = { customers: { items: rows, total: 240 } };
 * ```
 */
export type InitialData<TConfig> = IsAny<TConfig> extends true
  ? Record<string, any>
  : { [K in keyof TConfig as K extends keyof ExtractValues<TConfig> ? K : never]?: InitialNode<TConfig[K]> };

// ─── new Palistor(options) ───────────────────────────────────────────────────

/**
 * Options of `new Palistor(options)` and `usePalistor(options)`: the store's
 * ({@link ProxyStoreOptions}: `config`, `initialValues`, `context`,
 * `fieldMapping`) plus what a server render needs to be in the constructor.
 */
export interface PalistorOptions<
  TConfig extends Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  TMapping extends FieldMapping = {},
> extends ProxyStoreOptions<TConfig, TMapping> {
  /**
   * The translation function, applied before the tree is built: function-valued
   * `label` / `placeholder` / `description`, computed flags and `validate` get
   * it from the first render on, with no effect in between.
   * `store.setTranslator` (or `useTranslator`) replaces it later.
   */
  translator?: TranslateFn;
  /**
   * The notification function resolver `onError` callbacks reach as
   * `ctx.notify`. `store.setNotifier` (or `useNotifier`) replaces it later.
   */
  notifier?: NotifyFn;
  /**
   * Server mode: the store starts nothing by itself — no resolver, no page
   * fetch, no flow entry — until `store.start()`; whatever would have started
   * reads `loading: true`. Default: `typeof window === "undefined"`.
   */
  server?: boolean;
  /**
   * Results the server already has, in the shape of `getValues()` (see
   * {@link InitialData}). A node with `resolve` that gets data starts as
   * `resolved`, in the state its resolver's result would have left, and
   * re-runs on its declared `deps` / `contextDeps`, a filter or page-key
   * change, and `reload()`. Constructor only: there is no way to hand request
   * data to a store that outlives the request. `NoInfer`: the config type is
   * inferred from `config`, never from the data.
   */
  initialData?: InitialData<NoInfer<TConfig>>;
}

/**
 * A store instance: everything the store implementation's class types, plus
 * `start()`. Assignable wherever the store's `Palistor<TConfig, TMapping>` or
 * a `ProxyStore<TConfig, TMapping>` is expected.
 */
export interface Palistor<
  TConfig extends Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  TMapping extends FieldMapping = {},
> extends StorePalistor<TConfig, TMapping> {
  /**
   * Runs what the store starts by itself: every flow enters its active step,
   * the eager resolves start, and so does every resolve that was read
   * meanwhile. Outside server mode the constructor has already called it; in
   * server mode it is the explicit start (a script or a test in Node).
   * Idempotent.
   */
  start(): void;
}

/** The type of the `Palistor` class value: the store's constructor with Cube's options and instances. */
export interface PalistorConstructor {
  new <
    TConfig extends Record<string, any>,
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    const TMapping extends FieldMapping = {},
  >(
    options: PalistorOptions<TConfig, TMapping>,
  ): Palistor<TConfig, TMapping>;
  readonly prototype: Palistor<any, any>;
}

// ─── useForm ─────────────────────────────────────────────────────────────────

/** A leaf from `store.proxy` is as raw as a group from it: the same error type as the store's subtree overload. */
type ForbidRawLeaf<T> = T extends RawStoreProxyMarker ? RawNodeError : T;

/**
 * `useForm` as the package exports it: the store implementation's overloads
 * (the store, a group or a list from another `useForm`, a row reference, a
 * row with a template selector), and after them one more — a **field**. The
 * hook has always accepted a leaf handed down as a prop; only the type was
 * missing, so a one-field component had to take `any`.
 *
 * The leaf overload comes last on purpose: an argument typed `any` keeps
 * resolving to the store's first overload, as it did before.
 *
 * Not typed yet: a leaf of a store with a `fieldMapping` (its renamed props
 * are not a `FieldProxyNode`), like a group there when the map renames a prop
 * groups have. Both work at run time.
 *
 * Two more after it, handed down like a field: a list's **sort** node
 * (`list.sort`, a `sort` block) — the component follows the sort state — and
 * a list's **filter** node (`list.filter`, a `filter` block) — the component
 * follows the filter's own state (`isActive`, `isDraft`, `applied`, …).
 *
 * @example
 * ```tsx
 * function TextField({ field }: { field: FieldProxyNode<string> }) {
 *   const f = useForm(field); // its own tracking scope over one field
 *   return <input value={f.value} onChange={(e) => f.onValueChange(e.target.value)} />;
 * }
 *
 * function SortHeader({ sort, column }: { sort: SortProxyNode<ProductKey>; column: ProductKey }) {
 *   const s = useForm(sort); // re-renders when the sort changes, not when a row does
 *   return <button onClick={() => s.toggle(column)}>{column} {s.dirOf(column)}</button>;
 * }
 * ```
 */
export type UseForm = typeof StoreUseForm &
  (<T extends FieldProxyNode<any>>(input: ForbidRawLeaf<T>) => T) &
  (<K extends string>(input: SortProxyNode<K>) => SortProxyNode<K>) &
  ((input: FilterProxyNode) => FilterProxyNode);

// ─── <PalistorProvider> ──────────────────────────────────────────────────────

/** Props of `<PalistorProvider>`: what every `usePalistor` store below it starts with. All optional. */
export interface PalistorProviderProps {
  /**
   * Merged into the `context` of every store below (`store.context`); a store's
   * own `context` option wins per key. Compared per key, not by identity: an
   * inline object with the same values is not a change.
   */
  context?: Record<string, unknown>;
  /** The translation function of the stores below that are not given their own. Pass a stable function: a new one retranslates. */
  translator?: TranslateFn;
  /** The notification function (`ctx.notify` in resolver `onError`) of the stores below that are not given their own. */
  notifier?: NotifyFn;
  children?: ReactNode;
}
