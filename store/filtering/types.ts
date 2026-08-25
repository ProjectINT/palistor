import type { AnyConfigNode, ListState } from "../store/types";

/**
 * Runtime info for one declared filter field.
 *
 * Classification is per-field and syntactic: a field with `where` is a CLIENT
 * field (read-time projection, excluded from serverKey/params/deps), a field
 * without it is a SERVER field (its value becomes a resolver param and part of
 * the request identity). A field whose `value` is a function is DERIVED —
 * read-only, recomputed by the existing compute pipeline, excluded from both
 * keys and from params.
 */
export interface FilterFieldRuntime {
  /** Field key inside the filter block (the author's name). */
  key: string;
  /** The leaf config node registered in nodeState/valuesCache. */
  node: AnyConfigNode;
  /** Dot-path `$filters.<listPath>.<field>` — the dep/notification address. */
  path: string;
  /** `where` declared ⇒ client field. */
  isClient: boolean;
  /** `value` is a function ⇒ derived (read-only, excluded from both keys). */
  isDerived: boolean;
  /** Client predicate: keep `item` iff it returns true. Skipped while the
   *  field's value is empty (see {@link isFilterEmpty}). */
  where?: (item: unknown, value: unknown) => boolean;
  /** Server param name for this field's value (default: the field key). */
  param?: string;
  /** ms to debounce the INVALIDATION this field's changes cause (never the value). */
  debounce?: number;
  /** Declared default (after literal-shorthand expansion). `undefined` for derived. */
  defaultValue: unknown;
}

/**
 * Internal per-list filter state — the optional sidecar on {@link ListState}.
 * Mutated in place; the ListState identity is never recreated.
 */
export interface FilterState {
  /** Owning list — the tracking key for filter aggregates (isPending etc.). */
  listState: ListState;
  /** Dot-path of the owning list (e.g. "vehicles" or "ops.vehicles"). */
  listPath: string;
  /**
   * Synthetic group node holding the (shorthand-expanded) field nodes.
   * Lives OUTSIDE the config tree — registered at path `$filters.<listPath>`.
   */
  groupNode: AnyConfigNode;
  /** field key → runtime info. */
  fields: Map<string, FilterFieldRuntime>;
  /** dep path → runtime info (server + client), for the invalidation gate. */
  fieldsByPath: Map<string, FilterFieldRuntime>;
  /** Fast membership test: is a changed node one of this filter's leaves? */
  nodeSet: Set<object>;
  hasClientFields: boolean;
  hasServerFields: boolean;
  /** ALL field dep paths: `$filters.<listPath>.<field>`. */
  paths: Set<string>;
  /** Subset of `paths` for SERVER fields — the only paths seeded into resolver deps. */
  serverPaths: Set<string>;
  /** Stable hash of ALL non-derived field values — the client-projection memo key. */
  key: string;
  /** Stable hash of SERVER field values only — the request identity. */
  serverKey: string;
  /** serverKey the resolver last ran with. */
  issuedKey: string | null;
  /** Debounce handle; `isPending === (pendingTimer !== null)`. */
  pendingTimer: ReturnType<typeof setTimeout> | null;
  /** Client projection memo: valid while (key, store version) are unchanged. */
  memo: { key: string; version: number; ids: string[] } | null;
  /** Cross-field client rule, ANDed after the per-field `where`s. Always runs. */
  all?: (item: unknown, filterValues: Record<string, unknown>) => boolean;
  /** Escape hatch: shape ALL server params at once (overrides per-field `param`). */
  toParams?: (filterValues: Record<string, unknown>, context: Record<string, unknown>) => unknown;
  /** Persist filter values (opt-in — Phase 2, stored but not yet applied). */
  persist: boolean;
  /**
   * Transient flag: `set`/`reset`/`clear` force their (single) invalidation to
   * flush immediately, bypassing per-field debounce.
   */
  forceImmediate?: boolean;
}

/** Result of normalizing an author-facing filter block. */
export interface NormalizedFilterField {
  key: string;
  node: AnyConfigNode;
  isClient: boolean;
  isDerived: boolean;
  where?: (item: unknown, value: unknown) => boolean;
  param?: string;
  debounce?: number;
  defaultValue: unknown;
}

export interface NormalizedFilterBlock {
  fields: NormalizedFilterField[];
  all?: (item: unknown, filterValues: Record<string, unknown>) => boolean;
  toParams?: (filterValues: Record<string, unknown>, context: Record<string, unknown>) => unknown;
  persist: boolean;
}
