import {
  CONFIG_NODE,
  FILTER_SPREAD_KEYS,
  FILTER_STATE,
  CHAIN_SPREAD_KEYS,
  INFINITE_SPREAD_KEYS,
  LIST_STATE,
  LIST_ONLY_KEYS,
  LIST_SPREAD_KEYS,
  PAGINATION_SPREAD_KEYS,
} from "../constants";
import type { MappableKey } from "../constants";
import type { AnyConfigNode, ListState } from "../store/types";
import type { EntityData, EntityLeafNode } from "../entityRegistry/types";
import type { Palistor } from "../store/palistor";
import { generateTmpId } from "../entityRegistry";
import { applyClientFilter } from "../filtering/filterController";
import { buildFilterProxy } from "./buildFilterProxy";
import {
  currentFamily,
  currentPageOf,
  discardPendingAdds,
  displayTotal,
  ensureCurrentFamily,
  findPageWithId,
  getOrCreateEntry,
  hasIdInFamily,
  hasNextPageOf,
  isEntryExpired,
  isPaginatedDirty,
  loadedPagesOf,
  markStaleAfter,
  nextOrdinalOf,
  pageCountOf,
  pendingAddsOf,
  projectWindow,
  touchPage,
  warnOnce,
} from "../pagination/paginationController";
import type { QueryFamily } from "../pagination/types";
import {
  buildEntityProjectionProxy,
  buildEntityValuesWithLists,
} from "./buildEntityProjectionProxy";

// ─── arraysEqual helper ──────────────────────────────────────────────────────

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Keys of the per-entity list proxy. Same member set as
 * {@link LIST_SPREAD_KEYS}, but in the per-entity list's historical order —
 * kept until root and entity are aligned on keys.
 */
const ENTITY_LIST_SPREAD_KEYS: string[] = [
  "items",
  "length",
  "loading",
  "dirty",
  "error",
  "resolveStatus",
  "map",
  "getById",
  "add",
  "remove",
  "setItems",
  "getValues",
  "reload",
];

// ─── buildListProxy ──────────────────────────────────────────────────────────

/**
 * Build a ListProxyNode for a list — a SINGLE builder (root + per-entity).
 *
 * A list is identified by its {@link ListState} object. `listState.ownerEntity`
 * distinguishes the two cases:
 *   - `null`  → root list (state in `kernel.nodes.listStates`);
 *   - entity  → per-entity nested list (state in `owner.lists`).
 *
 * The skeleton, mutations, proxy and cache are shared. The spots where root
 * and entity still diverge (valuesCache sync, resolve/loading, add/setItems
 * semantics) dispatch on `owner` for now.
 *
 * The proxy exposes:
 *   items       — ReadonlyArray<EntityProjectionProxy>, one per itemId
 *   length      — number of items
 *   loading     — async resolver in progress
 *   dirty       — itemIds differ from the initial snapshot
 *   error       — error thrown by the last resolve run (null otherwise)
 *   resolveStatus — raw resolve status ("idle" | "pending" | "resolved" | "error")
 *   reload()    — force a resolver re-run
 *   add(id)     — add existing entity by ID
 *   add(values) — upsert entity + add to list
 *   remove(id)  — remove entity from list (entity stays in registry)
 *   getById(id) — find proxy by ID
 *   setItems(ids) — bulk-replace itemIds
 *   map(fn)     — map for React rendering
 *   getValues() — plain values snapshot of all items
 *   [Symbol.iterator] — iteration
 *
 * Entity proxies are cached per list instance (stable references for React);
 * the list proxy itself is cached per `ListState` in `kernel.nodes.listProxyCache`.
 */
export function buildListProxy(listState: ListState, kernel: Palistor<any, any>): object {
  // Stable proxy cache per ListState (single cache for root and per-entity).
  const cached = kernel.nodes.listProxyCache.get(listState as object);
  if (cached) return cached;

  const listConfigNode = listState.listConfigNode as AnyConfigNode;
  const template = listState.template as AnyConfigNode;
  const listConfig = listState.listConfig;
  /** List owner: `null` = root, EntityNode = per-entity. */
  const owner = listState.ownerEntity;

  // Per-list stable cache of entity projections (stable references for React).
  const entityProxyCache = new WeakMap<object, object>();

  /** Build EntityProjectionProxy for a given entityId. */
  function buildItemProxy(id: string): object | undefined {
    const entityNode = kernel.entityRegistry.get(id);
    if (!entityNode) return undefined;
    return buildEntityProjectionProxy(entityNode, template, kernel, entityProxyCache);
  }

  /** Current owner id (accounts for rekey via nodeState). Per-entity only. */
  const getOwnerId = (): string => {
    const idLeaf = owner!.id as object;
    return (
      (kernel.nodes.nodeState.get(idLeaf) as { value: unknown } | undefined)?.value ??
      (owner!.id as EntityLeafNode).value
    ) as string;
  };

  /** Notify observers that the list itself changed + recompute dependents. */
  const notifyListChanged = (): void => {
    kernel.syncListValuesCache(listState);
    if (owner) {
      // Per-entity: the isolated identity is the listState object itself; the
      // owner also goes into changed so `entity.values`/`entity.dirty` observers update.
      const changed = new Set<object>();
      changed.add(listState as unknown as object);
      changed.add(owner as unknown as object);
      const recomputed = kernel.recompute(changed);
      for (const n of changed) recomputed.add(n);
      kernel.notifyChanged(recomputed);
    } else {
      // Root: a PAGINATED list recomputes targeted — it sources to group path
      // "" and the groupDeps edges cover cross-group readers of its slot, so a
      // full-tree recompute per navigation (per `loadMore`) is pure waste.
      const recomputed = listState.pagination
        ? kernel.recompute(new Set<object>([listState as unknown as object, listConfigNode as object]))
        : kernel.recompute();
      // Root-list tracking is keyed by the ListState object.
      recomputed.add(listState as unknown as object);
      // Backward-compat bridge: older tests read getNodeVersion(listNode).
      recomputed.add(listConfigNode as object);
      kernel.notifyChanged(recomputed);
    }
  };

  /**
   * VISIBLE membership: the read-time client-filter projection when the list
   * has active `where` fields, the full `itemIds` otherwise. `itemIds` itself
   * is never rewritten — filtering is a projection, not a mutation.
   */
  const visibleIds = (): string[] =>
    listState.filter?.hasClientFields
      ? applyClientFilter(listState, kernel)
      : listState.itemIds;

  /**
   * Trigger lazy list resolve on first access (root + per-entity, single path).
   *
   * `options.suspense`: a pending run throws its promise (React Suspense).
   * A paginated list suspends ONLY while it has nothing renderable — the
   * first page, or a queryKey change without `keepPreviousData`; a page
   * navigation / `loadMore` / background revalidation keeps the current
   * window on screen and never unmounts it into a fallback.
   */
  const triggerLazyResolveIfNeeded = (): void => {
    if (!listConfig?.resolve) return;
    const st = kernel.resolveManager.getListResolveState(listState);
    // Root: the state exists (idle from initResolveStates). Entity: may be absent.
    if (!st || st.status === "idle") {
      // Defer: the GET trap fires during a React render; a synchronous
      // resolve→notify would yield "Cannot update a component while rendering another".
      queueMicrotask(() => kernel.resolveManager.triggerListResolve(listState));
      return;
    }
    if (
      listConfig.resolve.options?.suspense === true &&
      st.status === "pending" &&
      st.promise
    ) {
      if (!pg) throw st.promise;
      if (listState.itemIds.length === 0 && !pg.isPreviousData) throw st.promise;
    }
  };

  // ─── Pagination (root lists with `resolve.pagination`) ──────────────────────
  // Mutation inversion: pages are the source of truth, the window is always a
  // projection. Every local edit mutates the authoritative PageCacheEntry.ids
  // (never initialIds), then projectWindow + notify re-derive everything else.

  const pg = listState.pagination;
  const famNow = (): QueryFamily | undefined => (pg ? currentFamily(pg) : undefined);
  /** The family a local edit lands in — created on the bootstrap key before any fetch. */
  const famForEdit = (): QueryFamily =>
    famNow() ??
    ensureCurrentFamily(
      listState,
      kernel.resolveManager.pagedLiveValues(listState),
      kernel.context,
      Date.now(),
    ).fam;

  /**
   * Mutation inversion (root + nested): the row lands on the authoritative
   * page entry — paged/cursor the CURRENT page, infinite the LAST loaded
   * ordinal — and the window is re-derived. Dedup is family-wide (the same
   * entity must never sit on two cached pages); an over-full page is fine,
   * fullness math reads `fetchedCount`, never `|ids|`.
   */
  const pagedAdd = (entityId: string): void => {
    const fam = famForEdit();
    if (hasIdInFamily(fam, entityId)) return;
    const ordinal = currentPageOf(pg!);
    getOrCreateEntry(fam, ordinal, Date.now()).ids.push(entityId);
    if (pg!.mode === "infinite" && !pg!.loadedOrdinals.includes(ordinal)) {
      // First row of an empty infinite window: the ordinal becomes the
      // window so the optimistic row is actually visible.
      pg!.loadedOrdinals.push(ordinal);
    }
    projectWindow(listState);
    notifyListChanged();
  };

  /**
   * Paged/cursor: replace the CURRENT page's ids (ids parked on other cached
   * pages stay there — family-wide dedup); a cardinality change shifts the
   * later offsets, a same-length reorder stales nothing. Infinite refuses:
   * no correct page-boundary split of an arbitrary permutation exists (any
   * split changes which entry's baseline/guard/rekey finds each row, and a
   * later single-page refetch would roll back exactly one slice of the
   * user's ordering).
   */
  const pagedSetItems = (uniqueIds: string[]): void => {
    if (pg!.mode === "infinite") {
      const message =
        `[palistor] setItems() is not supported on the infinite-mode list ` +
        `"${pg!.listPath}": a multi-page window has no correct per-page assignment.`;
      if (process.env.NODE_ENV !== "production") throw new Error(message);
      console.warn(message);
      return;
    }
    const fam = famForEdit();
    const entry = getOrCreateEntry(fam, pg!.currentPage, Date.now());
    const next = uniqueIds.filter((id) => {
      const o = findPageWithId(fam, id);
      return o === undefined || o === pg!.currentPage;
    });
    const lengthChanged = next.length !== entry.ids.length;
    entry.ids = next;
    if (lengthChanged) markStaleAfter(fam, pg!.currentPage);
    projectWindow(listState);
    notifyListChanged();
  };
  const isFetching = (): boolean => (famNow()?.inFlight.size ?? 0) > 0;
  const isInfinite = pg?.mode === "infinite";
  /** cursor + infinite: the modes whose continuation runs off a cursor chain. */
  const isChain = !!pg && pg.mode !== "paged";

  /**
   * The guaranteed no-resolver hot path: a fresh cached page is a synchronous
   * projection + notify; only a miss / stale page enters the resolve pipeline.
   *
   * A page past `staleTime` is SERVED and revalidated in the background
   * (stale-while-revalidate); a page marked `stale` — its rows are known wrong
   * after an offset shift or an explicit `invalidate` — blocks on the fetch.
   */
  const setPageFn = (n: number): void => {
    if (!pg) return;
    if (!Number.isInteger(n) || n < pg.base) return;
    if (pg.mode === "infinite") {
      warnOnce(
        pg,
        "setPage-infinite",
        `[palistor] setPage() on the infinite-mode list "${pg.listPath}" is not a ` +
          `navigation — use loadMore() / refetch().`,
      );
      return;
    }
    const fam = famNow();
    const entry = fam?.pages.get(n);
    if (pg.mode === "cursor" && !entry && n !== nextOrdinalOf(pg)) {
      // A cursor chain only reaches an ordinal through its predecessor's
      // cursor — random access is not addressable on the server.
      warnOnce(
        pg,
        "setPage-cursor",
        `[palistor] setPage(${n}) on the cursor-mode list "${pg.listPath}" is ` +
          `unreachable: a cursor chain is sequential (use nextPage()/prevPage()).`,
      );
      return;
    }
    if (fam && entry && entry.status === "fresh") {
      pg.currentPage = n;
      pg.loadedOrdinals = [n];
      touchPage(fam, n);
      projectWindow(listState);
      notifyListChanged();
      if (isEntryExpired(entry, pg, Date.now())) {
        // Served now, refreshed behind it — the reconcile recipe keeps
        // un-flushed local edits on the page.
        kernel.resolveManager.revalidatePaginated(listState, n);
      }
      return;
    }
    pg.currentPage = n;
    pg.loadedOrdinals = [n];
    void kernel.resolveManager.triggerPagedFetch(listState, n);
  };
  const nextPageFn = (): void => {
    if (!pg || !hasNextPageOf(pg, famNow())) return;
    setPageFn(pg.currentPage + 1);
  };
  const prevPageFn = (): void => {
    if (!pg || pg.currentPage <= pg.base) return;
    setPageFn(pg.currentPage - 1);
  };
  const loadMoreFn = (): void => {
    kernel.resolveManager.loadMorePaginated(listState);
  };
  const prefetchFn = (n: number): Promise<unknown> =>
    kernel.resolveManager.prefetchPaginated(listState, n);
  const setPageSizeFn = (n: number): void => {
    kernel.resolveManager.setPageSizePaginated(listState, n);
  };
  const refetchFn = (): Promise<unknown> => kernel.resolveManager.refetchPaginated(listState);
  const invalidateFn = (page?: number): void => {
    kernel.resolveManager.invalidatePaginated(listState, page);
  };
  const discardPendingAddsFn = (): void => {
    if (!pg) return;
    if (discardPendingAdds(listState).length > 0) notifyListChanged();
  };
  const setScrollAnchorFn = (id: string | null): void => {
    if (!pg) return;
    pg.scrollAnchor = id;
  };

  // ─── Mutations ───────────────────────────────────────────────────────────────

  // Overloads: add(id) → void; add(values) → created entity proxy (TItem).
  // The proxy is returned only for the values form (matches ListProxyNode.add).
  const addFn = (idOrValues: string | Record<string, unknown>): object | undefined => {
    const fromValues = typeof idOrValues !== "string";
    if (owner) {
      const ownerId = getOwnerId();
      let entityId: string;
      if (typeof idOrValues === "string") {
        entityId = idOrValues;
        if (!kernel.entityRegistry.has(entityId)) {
          throw new Error(
            `[palistor] per-entity list add("${entityId}"): entity not found in registry.`,
          );
        }
      } else {
        const rawId = (idOrValues as { id?: unknown }).id;
        entityId =
          typeof rawId === "string" && rawId.trim() !== "" ? rawId : generateTmpId();
        // set() registers leaf nodes + projectionObj (with its own recompute/notify).
        kernel.set({ ...(idOrValues as Record<string, unknown>), id: entityId });
      }
      const childNode = kernel.entityRegistry.get(entityId);
      if (childNode) {
        kernel.entityRegistry.setEntityOwner(childNode, ownerId, listConfigNode as object);
      }
      if (pg) {
        pagedAdd(entityId);
        return fromValues ? buildItemProxy(entityId) : undefined;
      }
      if (!listState.itemIds.includes(entityId)) {
        listState.itemIds.push(entityId);
      }
      notifyListChanged();
      return fromValues ? buildItemProxy(entityId) : undefined;
    } else {
      let entityId: string;
      if (typeof idOrValues === "string") {
        entityId = idOrValues;
        if (!kernel.entityRegistry.has(entityId)) return undefined;
      } else {
        // upsert entity into store (creates entityProjectionObj + registers leaves)
        kernel.set(idOrValues as EntityData);
        const entityNode = kernel.entityRegistry.upsert(idOrValues as EntityData);
        entityId = entityNode.id.value as string;
      }
      if (pg) {
        pagedAdd(entityId);
        return fromValues ? buildItemProxy(entityId) : undefined;
      }
      if (!listState.itemIds.includes(entityId)) {
        listState.itemIds.push(entityId);
        notifyListChanged();
      }
      return fromValues ? buildItemProxy(entityId) : undefined;
    }
  };

  const removeFn = (id: string): void => {
    if (pg) {
      // Paged: splice from whichever cached page holds the id (P — possibly
      // off-screen). A SERVER row (in initialIds) shifts every later offset,
      // so ordinals > P go stale; an un-flushed local add shifts nothing.
      const fam = famNow();
      if (!fam) return;
      const o = findPageWithId(fam, id);
      if (o === undefined) return;
      const entry = fam.pages.get(o)!;
      entry.ids.splice(entry.ids.indexOf(id), 1);
      // A SERVER row shifts every later offset. infinite stales nothing: the
      // later pages are ON SCREEN and a background refetch would reflow under
      // the user's scroll — only the continuation point (Σ fetchedCount) moves.
      if (pg.mode !== "infinite" && entry.initialIds.includes(id)) markStaleAfter(fam, o);
      projectWindow(listState);
      notifyListChanged();
      return;
    }
    const idx = listState.itemIds.indexOf(id);
    if (idx === -1) return;
    listState.itemIds.splice(idx, 1);
    notifyListChanged();
  };

  const getByIdFn = (id: string): object | undefined => {
    if (!listState.itemIds.includes(id)) return undefined;
    return buildItemProxy(id);
  };

  const setItemsFn = (ids: string[]): void => {
    // Dedupe, keeping first-occurrence order: add() already forbids duplicate
    // membership (.includes() guard), so setItems must uphold the same
    // invariant — duplicates collide React keys and break remove/dirty diffs.
    const uniqueIds = [...new Set(ids)];
    if (owner) {
      const ownerId = getOwnerId();
      for (const id of uniqueIds) {
        if (!kernel.entityRegistry.has(id)) {
          throw new Error(
            `[palistor] per-entity list setItems: entity "${id}" not found in registry.`,
          );
        }
      }
      for (const id of uniqueIds) {
        const childNode = kernel.entityRegistry.get(id);
        if (childNode) {
          kernel.entityRegistry.setEntityOwner(childNode, ownerId, listConfigNode as object);
        }
      }
      if (pg) {
        pagedSetItems(uniqueIds);
        return;
      }
      listState.itemIds = uniqueIds;
      notifyListChanged();
    } else if (pg) {
      pagedSetItems(uniqueIds);
    } else {
      listState.itemIds.length = 0;
      for (const id of uniqueIds) listState.itemIds.push(id);
      notifyListChanged();
    }
  };

  const mapFn = <R>(
    fn: (item: object, index: number, id: string) => R,
  ): R[] => {
    return visibleIds()
      .map((id, index) => {
        const proxy = buildItemProxy(id);
        if (!proxy) return undefined;
        return fn(proxy, index, id);
      })
      .filter((item): item is R => item !== undefined);
  };

  const getValuesFn = (): Array<Record<string, unknown>> =>
    listState.itemIds
      .map((id) => {
        const child = kernel.entityRegistry.get(id);
        return child ? buildEntityValuesWithLists(child, template, kernel) : undefined;
      })
      .filter((v): v is Record<string, unknown> => v !== undefined);

  /**
   * Force a resolver re-run, ignoring the resolved-state dedup.
   * Declared once per list proxy: the identity is stable, so it can sit in a
   * React deps array or an `onRetry` prop without re-triggering effects.
   * A no-op by construction when the list has no resolver.
   */
  const reloadFn = (): void => {
    kernel.resolveManager.triggerListResolve(listState, true);
  };

  // ─── Proxy object ──────────────────────────────────────────────────────────

  // Lazily built, stable filter proxy (lists with a `filter` block only).
  let filterProxy: object | null = null;
  const getFilterProxy = (): object => {
    if (!filterProxy) filterProxy = buildFilterProxy(listState, kernel);
    return filterProxy;
  };

  // internal → external projection of spread keys (mappable: loading, dirty).
  // FILTER_SPREAD_KEYS are appended raw and only for a list WITH a filter
  // block — a list without one keeps its key set byte-for-byte identical.
  const fwd = kernel.fieldMapping;
  const spreadKeys = [
    ...(owner ? ENTITY_LIST_SPREAD_KEYS : LIST_SPREAD_KEYS).map(
      (k) => fwd[k as MappableKey] ?? k,
    ),
    ...(listState.filter ? FILTER_SPREAD_KEYS : []),
    ...(listState.pagination ? PAGINATION_SPREAD_KEYS : []),
    ...(isInfinite ? INFINITE_SPREAD_KEYS : []),
    ...(isChain ? CHAIN_SPREAD_KEYS : []),
  ];

  const proxy = new Proxy(listConfigNode as unknown as Record<string, unknown>, {
    get(_target, key: string | symbol) {
      // Transparent config node (for debugging/useForm). NOT the tracking key.
      if (key === CONFIG_NODE) return listConfigNode;
      // The list identity brand — the tracking key (uniform for root and per-entity).
      if (key === LIST_STATE) return listState;
      // The filter sidecar brand — lets the tracking proxy subscribe visible
      // reads to the client filter fields. undefined without a filter block.
      if (key === FILTER_STATE) return listState.filter;

      if (typeof key === "symbol") {
        if (key === Symbol.iterator) {
          return function* () {
            for (const id of visibleIds()) {
              const itemProxy = buildItemProxy(id);
              if (itemProxy) yield itemProxy;
            }
          };
        }
        return undefined;
      }

      // Reverse mapping on input: external → internal (affects loading/dirty).
      // LIST_ONLY_KEYS are matched raw, before the translation: a fieldMapping
      // of `isInvalid → "error"` would otherwise rewrite `list.error` into
      // `isInvalid`, miss every case and silently return undefined.
      const ikey = LIST_ONLY_KEYS.has(key) ? key : (kernel.externalToInternal[key] ?? key);

      switch (ikey) {
        // ── Filter surface (raw-matched via LIST_ONLY_KEYS) ────────────────
        case "filter":
          return listState.filter ? getFilterProxy() : undefined;

        case "values":
          // VISIBLE item proxies — the render entry point (alias of `items`).
          if (!listState.filter) return undefined;
          triggerLazyResolveIfNeeded();
          return visibleIds()
            .map(buildItemProxy)
            .filter((item): item is object => item !== undefined);

        case "fullLength":
          if (!listState.filter) return undefined;
          triggerLazyResolveIfNeeded();
          return listState.itemIds.length;

        case "items":
          triggerLazyResolveIfNeeded();
          return visibleIds()
            .map(buildItemProxy)
            .filter((item): item is object => item !== undefined);

        case "length":
          triggerLazyResolveIfNeeded();
          return visibleIds().length;

        case "loading":
          // Paginated: derived from the current family's in-flight set — N
          // concurrent page fetches, one status flag would flip false early.
          if (pg) return isFetching();
          // Single source for root and per-entity: the resolve-state status.
          return (
            kernel.resolveManager.getListResolveState(listState)?.status === "pending"
          );

        // ── Pagination surface (gated: undefined on a non-paginated list) ─
        case "page":
          // infinite: DERIVED from what actually loaded — never a stored
          // pointer that a failed fetch could have advanced past a hole.
          return pg ? currentPageOf(pg) : undefined;
        case "pageSize":
          return pg ? pg.pageSize : undefined;
        case "pageCount":
          return pg ? pageCountOf(pg, famNow()) : undefined;
        case "total":
          return pg ? displayTotal(famNow()) : undefined;
        case "serverTotal":
          return pg ? famNow()?.serverTotal : undefined;
        case "hasNextPage":
          return pg ? hasNextPageOf(pg, famNow()) : undefined;
        case "hasPrevPage":
          return pg ? pg.currentPage > pg.base : undefined;
        case "isFetching":
          return pg ? isFetching() : undefined;
        case "isInitialLoading":
          // Never a skeleton while the previous query's rows are on screen.
          return pg ? isFetching() && !pg.isPreviousData && !famNow()?.pages.size : undefined;
        case "setPage":
          return pg ? setPageFn : undefined;
        case "nextPage":
          return pg ? nextPageFn : undefined;
        case "prevPage":
          return pg ? prevPageFn : undefined;
        case "refetch":
          return pg ? refetchFn : undefined;
        case "invalidate":
          return pg ? invalidateFn : undefined;
        case "prefetch":
          return pg ? prefetchFn : undefined;
        case "setPageSize":
          return pg ? setPageSizeFn : undefined;
        case "isPreviousData":
          return pg ? pg.isPreviousData : undefined;
        case "isStaleFromStorage":
          return pg ? pg.isStaleFromStorage : undefined;
        case "pendingAdds":
          return pg ? pendingAddsOf(pg, famNow()) : undefined;
        case "discardPendingAdds":
          return pg ? discardPendingAddsFn : undefined;
        case "scrollAnchor":
          return pg ? pg.scrollAnchor : undefined;
        case "setScrollAnchor":
          return pg ? setScrollAnchorFn : undefined;

        // ── infinite mode only ────────────────────────────────────────────
        case "loadMore":
          return isInfinite ? loadMoreFn : undefined;
        case "isFetchingNextPage":
          // A footer spinner, never the first-load skeleton: false while the
          // window is still empty (that state is `isInitialLoading`).
          return isInfinite
            ? pg!.loadedOrdinals.length > 0 && (famNow()?.inFlight.has(nextOrdinalOf(pg!)) ?? false)
            : undefined;
        case "loadedPages":
          return isInfinite ? loadedPagesOf(pg!, famNow()) : undefined;
        case "continuationLost":
          return isChain ? (famNow()?.continuationLost ?? false) : undefined;


        case "error":
          // Projection of the existing ResolveState — no separate error state.
          return kernel.resolveManager.getListResolveState(listState)?.error ?? null;

        case "resolveStatus":
          // No resolve state yet (per-entity list before its first run) reads
          // as "idle", the same value initResolveStates gives a root list.
          return kernel.resolveManager.getListResolveState(listState)?.status ?? "idle";

        case "reload":
          return reloadFn;

        case "dirty":
          // Paginated: per mode. infinite uses the exact per-page rollup — a
          // window-level compare can read equal while a page still carries
          // un-flushed edits, once `dedupe` collapsed a cross-page duplicate.
          if (pg) return isPaginatedDirty(listState);
          // dirty by composition: current itemIds differ from initial snapshot
          return !arraysEqual(listState.itemIds, listState.initialItemIds);

        case "add":
          return addFn;

        case "remove":
          return removeFn;

        case "getById":
          return getByIdFn;

        case "setItems":
          return setItemsFn;

        case "map":
          triggerLazyResolveIfNeeded();
          return mapFn;

        case "getValues":
          return getValuesFn;

        default:
          return undefined;
      }
    },

    set(_target, _key, _value) {
      // Lists are not directly writable via proxy
      return false;
    },

    ownKeys() {
      return spreadKeys;
    },

    getOwnPropertyDescriptor(_target, key: string | symbol) {
      if (typeof key === "symbol") return undefined;
      if (!spreadKeys.includes(key as string)) return undefined;
      // Array targets have a non-configurable `length` property.
      // The proxy invariant requires that we mirror this exactly.
      if (key === "length") {
        return { configurable: false, enumerable: false, writable: true, value: visibleIds().length };
      }
      return { configurable: true, enumerable: true, writable: false };
    },
  });

  kernel.nodes.listProxyCache.set(listState as object, proxy);
  return proxy;
}
