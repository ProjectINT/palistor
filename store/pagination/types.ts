import type { PageMode, PaginationConfig } from "../store/types";

// ─── Resolver contract ───────────────────────────────────────────────────────

/**
 * Page request delivered as `ctx.page` on the shared {@link ListResolveContext}
 * (present iff the list declares `resolve.pagination`).
 */
export interface PageRequest {
  /** Page ordinal, honoring `base`. */
  page: number;
  pageSize: number;
  /** `(page - base) * pageSize` — convenience for LIMIT/OFFSET APIs. */
  offset: number;
  /** cursor / infinite mode: the cursor this page is fetched with. */
  cursor?: string | null;
  /** Current queryKey hash (logging / manual caches). */
  queryKey: string;
}

/** Structured result a paginated resolver may return (a bare array still works). */
export interface PagedResult<T = Record<string, unknown>> {
  items: T[];
  /** Server-truth total → `serverTotal` → `pageCount` / `hasNextPage`. */
  total?: number;
  /** cursor / infinite mode: the cursor that fetches the NEXT page. */
  nextCursor?: string | null;
  /** Fallback when `total` is unknown. */
  hasMore?: boolean;
}

// ─── Cache model ─────────────────────────────────────────────────────────────

/**
 * - `fresh`      — served without a fetch;
 * - `stale`      — served, but the next visit refetches;
 * - `refetching` — a replacement is in flight: excluded from the cross-page
 *   dedup source and still counted by the contiguous-page heuristic.
 */
export type PageStatus = "fresh" | "stale" | "refetching";

export interface PageCacheEntry {
  /** Entity ids of this page (bodies live in EntityRegistry). Mutated by local edits. */
  ids: string[];
  /**
   * Fetch-time snapshot — the SOLE per-page dirty baseline. Written at
   * fetch / hydrate / rekey-promotion, never by write-through.
   */
  initialIds: string[];
  /**
   * Rows the SERVER returned for this ordinal, PRE cross-page dedup. The
   * continuation counter (infinite) is `Σ fetchedCount`, never `Σ|initialIds|`.
   */
  fetchedCount: number;
  status: PageStatus;
  fetchedAt: number;
  nextCursor?: string | null;
  /** `PagedResult.hasMore` as returned for this page (`false` for an empty page). */
  hasMore?: boolean;
  /**
   * A page whose rows left memory — restored from storage trimmed
   * (`persist.maxPages`) or truncated off the head of the window
   * (`pagination.maxPages`): it carries `fetchedCount` only, so the infinite
   * continuation counter (`Σ fetchedCount`) survives. Never in
   * `loadedOrdinals`, never LRU-evicted, never re-fetched in place.
   */
  tombstone?: boolean;
}

export interface QueryFamily {
  queryKeyHash: string;
  /** Auto-dep paths that FORM this family's key (queryKey-formation set). */
  dependencies: Set<string>;
  /**
   * `false` until the first successful completion refined `dependencies` from
   * the tracking proxy. An unsettled family's hash is a bootstrap key and is
   * renamed in place on completion; a settled family's hash is authoritative.
   */
  settled: boolean;
  /** Page ordinal → cached page. */
  pages: Map<number, PageCacheEntry>;
  /** LRU order of ordinals (for `maxCachedPages`). */
  order: number[];
  /** PER-FAMILY, per-ordinal in-flight dedup (released by identity in `finally`). */
  inFlight: Map<number, Promise<unknown>>;
  /**
   * SERVER-TRUTH total: set from `PagedResult.total`; +1 on rekey-promotion,
   * −1 on delete of a server row. NEVER touched by optimistic add/remove.
   */
  serverTotal?: number;
  nextCursor?: string | null;
  lastActiveAt: number;
  /**
   * cursor / infinite: ordinal → the cursor that FETCHED it (`null` for the
   * first ordinal of the chain). The authoritative chain — `entry.nextCursor`
   * would be lost with an LRU-evicted page.
   */
  cursors: Map<number, string | null>;
  /**
   * `"hydrated"` while the chain still runs off cursors restored from storage
   * (older than the storage round-trip by definition): the first continuation
   * failure under it triggers a transparent rebuild instead of an error.
   */
  continuationTrust: "live" | "hydrated";
  /**
   * The cursor chain could not be rebuilt — `hasNextPage` reports false and
   * `list.continuationLost` tells the UI to offer "Reload feed" rather than a
   * Load-more button that always fails.
   */
  continuationLost: boolean;
  /** `gcTime` eviction timer of an inactive family (cleared when it goes current again). */
  gcTimer?: ReturnType<typeof setTimeout> | null;
}

export type ResolvedPaginationConfig = Required<
  Pick<
    PaginationConfig,
    | "pageSize"
    | "mode"
    | "base"
    | "initialPage"
    | "staleTime"
    | "maxCachedQueries"
    | "maxCachedPages"
    | "maxPages"
    | "gcTime"
    | "keepPreviousData"
    | "revalidateOnHydrate"
    | "persist"
    | "persistPendingAdds"
  >
> & { queryKey?: PaginationConfig["queryKey"] };

/**
 * The optional `pagination` sidecar on a {@link ListState} — a root list, or
 * one per-entity instance of a nested list.
 */
export interface PaginationState {
  mode: PageMode;
  pageSize: number;
  base: 0 | 1;
  /**
   * Dot-path of the owning list — self-referential dep exclusion and the
   * persist blob key. A nested instance carries `"<ownerId>.<fieldPath>"`
   * (diagnostics only: its resolver reads the owner snapshot, which never
   * contains the list, and nested windows are not persisted as blobs).
   */
  listPath: string;
  /** Active family key; assigned at ISSUE time (never left null after a fetch). */
  currentQueryKey: string | null;
  /** paged: the active ordinal. */
  currentPage: number;
  /** infinite: accumulated ordinals (joined on SUCCESS); paged / cursor: `[currentPage]`. */
  loadedOrdinals: number[];
  families: Map<string, QueryFamily>;
  /** LRU over family keys (`maxCachedQueries`). */
  familyOrder: string[];
  /** Monotonic epoch — bumped on reset / evict / queryKey change / forced issue. */
  generation: number;
  config: ResolvedPaginationConfig;
  /** One-time dev warnings already emitted for this list. */
  warned: Set<string>;
  /**
   * `keepPreviousData`: the projected window still belongs to the PREVIOUS
   * query key while the new one's first page loads.
   */
  isPreviousData: boolean;
  /** The window came from storage and was already past `staleTime` when restored. */
  isStaleFromStorage: boolean;
  /** First visible row recorded by `setScrollAnchor` (persisted with `persist: 'window'`). */
  scrollAnchor: string | null;
}

// ─── Persist blob (Phase 2: the whole window + pointer) ──────────────────────

/** One persisted page. A trimmed head page keeps `fetchedCount` only (tombstone). */
export interface PaginationPersistPage {
  ordinal: number;
  ids: string[];
  initialIds: string[];
  fetchedCount: number;
  hasMore?: boolean;
  nextCursor?: string | null;
  tombstone?: boolean;
}

export interface PaginationPersistBlob {
  v: 2;
  fingerprint: { mode: PageMode; pageSize: number; base: 0 | 1 };
  savedAt: number;
  currentPage: number;
  /** infinite: the accumulated window (paged / cursor: `[currentPage]`). */
  loadedOrdinals: number[];
  serverTotal?: number;
  /** Settled dep set of the current family (never a bare bootstrap set). */
  deps: string[];
  settled: boolean;
  /** `[path, value]` pairs — the key is RECOMPUTED at seed time, never persisted. */
  depValues: Array<[string, unknown]>;
  /** Only when the `queryKey` escape hatch is configured (no dep values to replay). */
  queryKeyAtSave?: string;
  /** Window pages in ordinal order; head pages may be tombstones. */
  pages: PaginationPersistPage[];
  /** cursor / infinite: `[ordinal, cursor]` pairs — an optimistic hint only. */
  cursors?: Array<[number, string | null]>;
  /** Un-flushed optimistic adds (`persistPendingAdds: 'keep'`). */
  pendingAdds?: string[];
  /** `persist: 'window'` opt-in: the first visible row at save time. */
  anchorId?: string;
  /** Bodies of ids in `initialIds ∖ ids` (locally removed server rows). */
  entities?: Record<string, Record<string, unknown>>;
}
