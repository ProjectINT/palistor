# List Pagination & Page Caching — Design Plan

Palistor lists today resolve as an all-or-nothing set: `executeListResolve` replaces the whole `itemIds` array on every run. This plan adds **opt-in pagination with page-level caching** so that a list can be fetched one page at a time and switching to an **already-loaded page is a synchronous projection with no resolver call**. Only a cache miss, a stale page, or a change to the resolver's dependency values (filter / search / context — a new "queryKey") may call the resolver. The design is structural: it rides a single optional `pagination` sidecar on the existing `ListState`, reuses `EntityRegistry` normalization (a page is a cheap `string[]` of ids), and leaves `executeListResolve` and every non-paginated list byte-for-byte unchanged.

The document folds in the concurrency, invalidation, values/dirty/persist, compat/tracking, and mutation-reconciliation fixes surfaced in review — none of the known gaps are left open.

**Revision 2026-07-19** (after two code-verification + adversarial-review passes): pages are now the single source of truth and the window is a pure projection (**mutation inversion**); `projectWindow` is mode-agnostic over `windowOrdinals`; **infinite mode is fully specified** (cursor-first, derived `currentPage`, window ordinals pinned from LRU, truncating cursor invalidation, per-page dirty rollup); the paged executor **drops the `structuredClone` values snapshot** for a copy-on-read tracking proxy; accounting is **derived** (`serverTotal` + per-page delta, continuation from `fetchedCount`) with an idempotent **rekey-promotion** rule; reset is a mode-agnostic per-page rollback; **`refetch()` is exactly one request in every mode** (the chain refetch was designed and rejected); **persist carries six mandatory safety rules** without which a restored window is served under the wrong dep/context values or evicted by hydration itself. See the Decision ledger near the end.

## Core idea

Entities are already normalized and globally deduped in `EntityRegistry` (`store/entityRegistry/entityRegistry.ts`), so a list never owns entity bodies — it owns an ordered `string[]` of ids. Pagination exploits this directly: `listState.itemIds` becomes the **current visible window** (a projection), and the real cache is a two-level `Map<queryKeyHash, QueryFamily>` on a new optional `listState.pagination` sidecar, where a family holds `Map<pageOrdinal, PageCacheEntry>` and each entry is just `{ ids, initialIds }`. A page fetch fills a `PageCacheEntry`; navigation runs a single pure function `projectWindow(listState)` that copies the cached page's ids into `itemIds` (and its `initialIds` into `initialItemIds`) and bumps the `ListState` version. A cached-page switch therefore never enters the resolve pipeline. A dep/context change recomputes the queryKey; a different key means a different result set, so the old family is invalidated and paging resets to page 1 with exactly one fetch. Every existing reader (`syncListValuesCache`, `getValues`, `dirty`, `reset`, `rekey`, the tracking proxy, per-entity projection) keeps reading `itemIds`/`initialItemIds` and needs only additive, `if (listState.pagination)`-gated branches.

**One authoritative statement of where dependency sets live and who reads them** (this is the spine of the invalidation model, referenced throughout):

1. **`ResolveState.dependencies`** (the root `ResolveState` in `ResolveManager.states`, keyed by `listConfigNode`) is the **retrigger-SELECTION key**. It and only it is read by `findResolvesToRetrigger` and `retriggerByPaths` to decide whether a `changedPaths` set touches this list.
2. **`QueryFamily.dependencies`** is the **queryKey-FORMATION key** — the dep set whose *values* form the current family's hash.
3. **`executePagedListResolve` keeps both consistent on every successful run**: after a page resolves, it folds the tracking proxy's newly-accessed paths into the *current family's* `dependencies`, and writes `state.dependencies = union of all live families' dependency sets` (preserving the `$context.` prefix convention) so that `findResolvesToRetrigger`/`retriggerByPaths` can still SELECT the entry when an auto-tracked filter changes. Routing auto-deps only to `fam.dependencies` (and never to `state.dependencies`) would make auto-dep invalidation silently never fire — this is the single most important compat rule in the design.

## Author-facing API

Pagination is authored inside `resolve` (it needs the resolver) via a single `pagination?` block. Its presence is the **only** opt-in switch. It is not field-mapping vocabulary, so it is not normalized in the `Palistor` constructor.

```ts
// store/store/types.ts
export type PageMode = "paged" | "infinite" | "cursor";

export interface PaginationConfig {
  pageSize: number;
  mode?: PageMode;            // default "paged"
  base?: 0 | 1;              // page numbering base; default 1
  initialPage?: number;      // default = base
  staleTime?: number;        // ms a cached page stays fresh; default Infinity (never auto-refetch)
  maxCachedQueries?: number; // families kept; default 1 (evict foreign family on queryKey change)
  maxCachedPages?: number;   // LRU cap on pages within a family; default Infinity
  /** Escape hatch when auto-dep values aren't cleanly serializable. */
  queryKey?: (values: any, context: Record<string, unknown>) => unknown[];
}

export interface ListResolveConfig {
  // Arg 3 is the SHARED ListResolveContext (amended per FilteringPlan.md —
  // two plans cannot each own the third argument). `page` rides inside it.
  resolver: (values: any, store: ProxyStore<any>, ctx: ListResolveContext)
    => Promise<Array<Record<string, unknown>> | PagedResult>;
  onError?: (error: unknown, ctx: { notify: (...a: any[]) => void }) => void;
  deps?: string[];
  pagination?: PaginationConfig;   // ← presence is the opt-in
  options?: { lazy?: boolean; suspense?: boolean };
}

// Already shipped by the filtering implementation (store/store/types.ts):
//   interface ListResolveContext {
//     filter: { values; params; key };   // filtering (implemented)
//     page?: PageRequest;                // THIS plan fills the reserved seam
//     sort?: SortRequest;                // reserved
//     queryKey: string;
//     signal?: AbortSignal;              // reserved
//   }
// ctx is always passed; `page` is present iff the list declares `pagination`.
```

`store/defineList.ts` gains a `pagination?: PaginationConfig` passthrough on its `resolve` block and threads it verbatim into `listConfig.resolve.pagination`. The list node shape `[template, { resolve }]` is unchanged, so `TypedListNode` / `ConfigNodeToProxy` / `isListNode` detection is untouched.

Full example, modeled on the users/products lists in `app-demo/src/config/catalog/catalogConfig.ts`:

```ts
users: defineList<User>({
  template: { id: { value: "" }, name: { value: "" }, email: { value: "" } },
  resolve: {
    deps: ["search"],                          // seeds the bootstrap queryKey before auto-deps exist
    pagination: { pageSize: 20, mode: "paged" },
    resolver: async (values, store, ctx) => {
      const r = await api.users({
        q: values.search,
        tenant: store.context.tenantId,        // auto-tracked $context dep
        ...ctx.filter.params,                  // declared filter params (FilteringPlan)
        offset: ctx.page!.offset,
        limit: ctx.page!.pageSize,
      });
      return { items: r.rows, total: r.count }; // PagedResult
    },
  },
})
```

### Resolver contract

```ts
// store/resolvePipeline/types.ts  (new exports)
export interface PageRequest {
  page: number;            // honoring `base`
  pageSize: number;
  offset: number;          // (page - base) * pageSize — convenience for LIMIT/OFFSET APIs
  cursor?: string | null;  // cursor mode
  queryKey: string;        // current queryKeyHash (logging / manual caches)
}
// Delivered as `ctx.page` on the shared ListResolveContext (see Author-facing
// API). Filtering already ships the ctx plumbing; this plan only fills the
// reserved `page` seam. One extra joint rule from FilteringPlan.md: a list's
// declared SERVER filter paths (`FilterState.serverPaths`) are seeded into the
// bootstrap `QueryFamily.dependencies`, so the very first `computeQueryKey`
// already includes the filter values and the re-key-in-place dance is never
// entered for a filter field.
export interface PagedResult<T = Record<string, unknown>> {
  items: T[];
  total?: number;              // → family.total → pageCount / hasNextPage
  nextCursor?: string | null;  // cursor / infinite mode
  hasMore?: boolean;           // fallback when total is unknown
}
```

**Dispatch is config-driven, never shape-sniffed.** The list branch checks `listState.pagination`, not the resolver's return shape. A paginated resolver that still returns a bare array is normalized once inside the paged executor: `const norm = Array.isArray(r) ? { items: r } : r;` (this loses precise `total`; `pageCount` then falls back to the loaded-page heuristic — acceptable, documented). Backward compatibility for non-paginated lists is structural: no `pagination` block ⇒ no state allocated ⇒ the plain `executeListResolve` path runs exactly as today.

## Consumer-facing API

Non-paginated lists keep `LIST_SPREAD_KEYS` unchanged. When `listState.pagination` exists, `buildListProxy` unions `PAGINATION_SPREAD_KEYS` into the spread key set (see Cross-cutting for the both-branches rule), and every new GET/method case is gated behind `if (listState.pagination)`, so a non-paginated list's `ownKeys` / spread / GET set is byte-for-byte identical.

**Reactive getters** (each reads `listState.pagination` + `getListResolveState(listState)`, and is tracked by the `ListState` identity that navigation bumps):

| Getter | Value |
|---|---|
| `page` | `pagination.currentPage` (infinite: derived `max(loadedOrdinals)`) |
| `pageSize` | `pagination.config.pageSize` |
| `total` | **display** total: `serverTotal + Σ(\|ids\| − \|initialIds\|)` over cached pages (undefined if the server total is unknown) — moves immediately on an optimistic add/remove |
| `serverTotal` | **raw** server-truth total (`family.serverTotal`) — moves only on fetch / delete-of-server-row / rekey-promotion. Both are exposed: display for the list's own counter, raw for "N items on the server" badges. Shipping only one would force every counter UI to guess which meaning it got |
| `pageCount` | `total != null ? ceil(total / pageSize)` : count of contiguous fresh cached pages |
| `hasNextPage` | **paged:** `serverTotal != null ? page < base + pageCount − 1 : lastFetchWasFull`; **infinite:** `Σ\|initialIds\| < serverTotal`, else `lastPage.hasMore ?? lastFetchWasFull`; **cursor:** `family.nextCursor != null`. Never influenced by local adds/removes — fullness is `initialIds.length === pageSize` (a fetch-time fact) and `serverTotal` moves only on server-truth events, so an optimistic add cannot fabricate a phantom next page |
| `hasPrevPage` | `page > base` |
| `loading` | **unchanged legacy meaning**, but re-derived: `family.inFlight.size > 0` (see below) |
| `isFetching` | native pagination getter = `family.inFlight.size > 0` (any page fetching) |
| `isInitialLoading` | `isFetching && !family?.pages.size` (skeleton vs spinner) |
| `isFetchingNextPage` *(infinite)* | `fam.inFlight.has(max(loadedOrdinals) + 1)` — footer spinner, distinct from `isInitialLoading` |
| `loadedPages` *(infinite)* | frozen snapshot `Array<{ ordinal, ids: readonly string[] }>` (never the live `pages` Map — entries are the source of truth under mutation inversion) — for section-header UIs |

**`loading`/`isFetching` are derived from in-flight state, not the single `ResolveState.status`.** Because there are N concurrent per-page fetches, a single `status === 'pending'` boolean flips false when *any* page completes while others are still loading. Both getters read `family.inFlight.size > 0`; the executor only writes `state.status = 'resolved'` when the current family's `inFlight` drains. The legacy `loading` getter stays pointed at the same in-flight signal so non-paginated behavior is unchanged.

**Methods** (mutate `pagination`, then either project+notify synchronously, or fetch):

- `setPage(n)` — the guaranteed no-resolver hot path (below)
- `nextPage()` / `prevPage()` — `setPage(page ± 1)`
- `loadMore()` *(infinite, Phase 2)* — the target is **always `max(loadedOrdinals) + 1`**, never a stored `currentPage++` (a failed fetch must not skip an ordinal: increment-then-fail would leave `currentPage = N+1` with nothing loaded, and the next tap would fetch `N+2`, permanently dropping page `N+1`'s rows). If the target is cached fresh: append to `loadedOrdinals` + project. Else fetch — the ordinal joins `loadedOrdinals` **only on successful completion**. A `loadMore` while one is in flight is a **no-op** (UI disables via `isFetchingNextPage`)
- `refetch()` — **always exactly ONE request, in every mode.** **paged:** mark the *whole current family* stale, refetch the current page now; siblings refetch lazily on visit (staling only `> currentPage` is not enough — a server-side insert at the head shifts *earlier* pages too, so navigating back would render one row on two pages, and with `staleTime: Infinity` it never self-corrects). **infinite (both offset and cursor):** truncate to `initialPage` and refetch it — i.e. `invalidate(initialPage)` + fetch, reusing the settled truncating-invalidation primitive verbatim. This is pull-to-refresh semantics: start over from the top, one round-trip. Before truncating, **harvest local-only rows** (`ids ∖ initialIds`) from every dropped page and re-append them to the surviving page, so a refresh gesture never silently destroys un-flushed user input. Issued with `force` (bypasses the in-flight dedup — see executor step 2) and **superseding** (bumps `generation`); the returned promise settles on the effective run and never rejects (errors land on the resolve state). Resets `autoRetriggerCount` **once per call**, never per leg.
  *A chain refetch (re-fetch every loaded ordinal, preserving the window) was designed and rejected — see the ledger. It is reachable later through the reserved argument `refetch({ pages: 'loaded' })`, whose name makes its cost self-documenting.*
- `invalidate(scope?)` — mark one page / the whole current family `stale`; next visit refetches
- `prefetch(n)` *(Phase 2)* — fetch ordinal `n` into cache without moving `currentPage`
- `setPageSize(n)` *(Phase 2)* — clear families, reset to `initialPage`, fetch

Pagination **methods** stay in the untracked forward branch of the tracking proxy; only the **getters** above drive re-renders.

**The guaranteed no-resolver path — `setPage(n)`:**

```
1. fam   = pagination.families.get(pagination.currentQueryKey)
2. entry = fam?.pages.get(n)
3. if (entry && entry.status === "fresh"
        && (staleTime === Infinity || now - entry.fetchedAt < staleTime)) {
     pagination.currentPage = n;
     projectWindow(listState);   // itemIds = entry.ids; initialItemIds = entry.initialIds; syncListValuesCache
     notifyListChanged();        // bumps ListState (+ listConfigNode bridge) → granular re-render
     return;                     // synchronous — NO resolver, NO await, NO queueMicrotask
   }
4. pagination.currentPage = n;
   resolveManager.triggerListPageResolve(listState, n);  // miss/stale → executePagedListResolve
```

Step 3 is the structural guarantee: no path into the resolve pipeline is taken for a fresh cached page.

**React usage** (a Pager component that reads *only* `page`/`pageCount`, a common split-out control — this must re-render, see the tracking-proxy fix in Cross-cutting):

```tsx
function UsersPager() {
  const users = useStore(s => s.users);
  return (
    <>
      {users.isInitialLoading ? <Skeleton/> :
        users.items.map(u => <Row key={u.id} user={u}/>)}
      <nav>
        <button disabled={!users.hasPrevPage} onClick={users.prevPage}>Prev</button>
        <span>Page {users.page} of {users.pageCount}{users.isFetching && " …"}</span>
        <button disabled={!users.hasNextPage} onClick={users.nextPage}>Next</button>
      </nav>
    </>
  );
}
```

## Internal model

```ts
// store/store/types.ts — ListState gains ONE optional field
export interface ListState {
  listConfigNode: object;
  template: object;
  listConfig?: ListConfig;
  ownerEntity: EntityNode | null;
  itemIds: string[];         // NOW the current visible WINDOW (projection)
  initialItemIds: string[];  // baseline for the current window, sourced from the page's initialIds
  pagination?: PaginationState; // present iff resolve.pagination configured AND ownerEntity === null (Phase 1)
}
```

```ts
// store/pagination/types.ts (new)
export interface PageCacheEntry {
  ids: string[];        // entity ids for this page (bodies live in EntityRegistry)
  initialIds: string[]; // fetch-time snapshot → the SOLE per-page dirty baseline; set at fetch/hydrate/rekey-promotion
  fetchedCount: number; // rows the SERVER returned for this ordinal, PRE cross-page dedup.
                        // The continuation counter is Σ fetchedCount — NOT Σ|initialIds|: dedup can shrink
                        // initialIds (a revalidated page 1 whose tail rows moved into page 2 stores 18 of 20),
                        // which would silently shift every later offset. Moves with the same server-truth
                        // events as serverTotal (delete of a fetched row −1, rekey-promotion +1).
  status: "fresh" | "stale" | "refetching"; // 'refetching' = replacement in flight: excluded from the cross-page
                        // dedup source and from the contiguous-fresh pageCount heuristic (marking it merely
                        // 'stale' would drop pageCount to 0 mid-refresh under a full, visible list)
  fetchedAt: number;
  nextCursor?: string | null;
}

export interface QueryFamily {
  queryKeyHash: string;
  dependencies: Set<string>;              // the auto-dep paths that FORMED this key (queryKey-formation)
  pages: Map<number, PageCacheEntry>;     // keyed by page ordinal (base..)
  order: number[];                        // LRU order of ordinals (maxCachedPages)
  inFlight: Map<number, Promise<unknown>>;// PER-FAMILY, per-ordinal in-flight dedup (released in finally)
  serverTotal?: number;                   // SERVER-TRUTH total: set from PagedResult.total; +1 on rekey-promotion,
                                          // −1 on delete of a server row (id present in some initialIds).
                                          // NEVER touched by optimistic add/remove — display total derives a local delta
  nextCursor?: string | null;             // cursor / infinite
  lastActiveAt: number;
  gcTimer?: ReturnType<typeof setTimeout> | null;
}

export interface PaginationState {
  mode: PageMode;
  pageSize: number;
  base: 0 | 1;
  currentQueryKey: string | null;   // active family key; assigned at ISSUE time (never left null after a fetch)
  currentPage: number;              // paged/cursor: active ordinal. infinite: DERIVED = max(loadedOrdinals),
                                    // read only by loadMore/hasNextPage — NEVER by projection, never stored ahead of a fetch
  loadedOrdinals: number[];         // infinite: accumulated pages (joined on SUCCESS, not at issue); paged: [currentPage]
  families: Map<string, QueryFamily>;
  familyOrder: string[];            // LRU over families (maxCachedQueries)
  generation: number;              // monotonic epoch; bumped on every reset, evict, queryKey change, cursor-chain truncation
  cursors?: Map<number, string | null>;
  config: Required<Pick<PaginationConfig,
    "pageSize"|"mode"|"base"|"initialPage"|"staleTime"|"maxCachedQueries"|"maxCachedPages">>
    & { queryKey?: PaginationConfig["queryKey"] };
}
```

Two deliberate concurrency primitives, absent from the naive design:

- **`inFlight` lives on `QueryFamily`, keyed by ordinal** — never on `PaginationState` keyed by ordinal alone. Ordinal 1 exists in every family; a single map would let a page-1 fetch under query A dedup a page-1 fetch under query B, permanently stranding B. On family eviction the whole `inFlight` map is dropped with the family, and every executor releases its entry in a `finally` so the drift/discard path cannot leak a dead promise.
- **`generation` is the supersede token.** `issuedKey === currentQueryKey && issuedOrdinal === currentPage` is *not* sufficient after an evict→recreate or reset (two fetches can both carry `key=A, ordinal=1`). The executor captures `issuedGeneration` at issue time; a write or a `projectWindow` is permitted only if `issuedGeneration === pagination.generation` **and** key+ordinal match. Any prior-generation completion is a pure no-op cleanup (release its `inFlight` entry, write nothing).
- **Window ordinals are pinned from LRU eviction.** `maxCachedPages` applies only to pages *outside* `windowOrdinals(p)` (off-window paged history, foreign families). In infinite mode the loaded window itself is not LRU-boundable: evicting a middle ordinal tears a hole in the projected concat — a crash on the strict read, or a silent 20-row upward shift under the user's scroll on the `?? []` fallback — and breaks reset's rollback (an evicted ordinal has no `initialIds` to restore from). A missing pinned ordinal in `projectWindow` is an invariant violation (dev-assert), never a fallback case.

`pagination` rides on the `ListState` already stored in `NodeRegistry.listStates`, which is already the tracking identity — no new registry, no WeakMap plumbing. A new module `store/pagination/paginationController.ts` owns pure helpers: `projectWindow`, `computeQueryKey`, `getOrCreateFamily`, `evictForeignFamilies`, `resetPagination`, `rekeyPagination`, `deleteIdEverywhere`, `seedFamilyFromWindow`, LRU helpers.

### queryKey derivation

`computeQueryKey` is a stable JSON hash over the resolver's dependency paths projected onto live values + context — the same set the pipeline already tracks:

```ts
function computeQueryKey(ls, depSet, getValues, context): string {
  const p = ls.pagination!;
  if (p.config.queryKey) return stableStringify(p.config.queryKey(getValues(), context));
  const parts = [...depSet].sort().map(d =>
    d.startsWith("$context.") ? [d, context[d.slice(9)]] : [d, getByPath(getValues(), d)]);
  return stableStringify(parts);
}
```

Hard rules:

- **Bootstrap:** before run 1 there are no auto-deps, so the key uses explicit `resolve.deps` (empty ⇒ a single constant bucket). The first fetch always runs; auto-deps captured on completion refine the family thereafter.
- **Dep-set widening is a re-key-in-place, not a foreign query.** When the first successful fetch refines `fam.dependencies` from the tracking proxy, the recomputed key almost always differs from the bootstrap key *even though no value changed*. Treating that as a new query would evict + refetch the page just loaded. Instead, `_retriggerPaginatedList` compares the new key against the current key **using the same (refined) dep set that formed the current family**; if the dep set merely widened with unchanged values, it **renames the family's hash in place** (update `queryKeyHash`, `currentQueryKey`, `familyOrder`) and does not evict or fetch. Only a genuine *value* change under the settled dep set invalidates.
- **`page` is deliberately never part of values/context** — it is the separate 3rd resolver arg. Advancing pages must never register as a dep change.
- **Self-referential deps are excluded — from BOTH sets.** Any dep path that resolves into the paginated list's own materialized slot (e.g. `values.<list>.length`) is dropped when forming `fam.dependencies` (else paging would perturb the queryKey and ping-pong to page 1 forever) **and from the executor's drift-comparison set** (else a sibling page's completion projecting into the slot mid-flight reads as "drift", and the concurrent-`setPage(2)`/`setPage(3)` scenario livelocks straight into `MAX_AUTO_RETRIGGERS`). A resolver reading its own slot gets a one-time dev warning — `PageRequest` is the API for "what's loaded", and under the live snapshot proxy a self-slot read deep-copies the whole window.

### The full invalidation model (wired to the existing machinery)

No rewrite of the retrigger logic. A filter/search/context change already flows `createPostNotifyHook → findResolvesToRetrigger(changedPaths, this.states, entries) → (loop) resetResolveState + _executeEntry`; `retriggerByPaths` does the same for `setContext`. We divert paginated entries inside **both** loops **and** the second (pending-mark) loop, at the exact point that preserves the cycle guard:

```ts
// inside the toRetrigger loop of createPostNotifyHook AND retriggerByPaths:
for (const entry of toRetrigger) {
  const state = this.states.get(entry.node);
  // --- cycle guard runs FIRST, for paginated entries too ---
  state.autoRetriggerCount = (state.autoRetriggerCount ?? 0) + 1;
  if (state.autoRetriggerCount > MAX_AUTO_RETRIGGERS) { warn(...); continue; }

  if (entry.isListNode) {
    const ls = this.listStates.get(entry.node);
    if (ls?.pagination) { this._retriggerPaginatedList(ls); continue; } // AFTER the bump
  }
  resetResolveState(state);           // untouched for non-paginated entries
  this._executeEntry(entry);
}
```

The divert sits **after** the `autoRetriggerCount` increment + `MAX_AUTO_RETRIGGERS` check so a self-referential paginated resolver (`A→A` each cycle) is capped exactly like every other resolver. `retriggerByPaths` resets `autoRetriggerCount = 0` for explicit `setContext` for paginated entries too, matching the non-paginated path. The **second postNotifyHook loop** (which sets `pendingRetrigger` on pending entries) is also gated to **skip** paginated entries, because `pendingRetrigger` is consumed only inside the legacy executors (`executeListResolve` / `executeResolve` / `executeEntityFieldResolve` — verified by grep), none of which a paginated list ever runs — an un-gated mark would be silently dropped. (`retriggerByPaths` itself has no pending-mark loop; mid-flight context changes are caught by the executor's own drift check.) Instead the paged executor owns its own requeue (below).

```ts
_retriggerPaginatedList(ls) {
  const p = ls.pagination!;
  const settledDeps = p.families.get(p.currentQueryKey!)?.dependencies
                    ?? new Set(ls.listConfig!.resolve!.deps ?? []);
  const newKey = computeQueryKey(ls, settledDeps, this.getValues, this.store.context);

  if (newKey === p.currentQueryKey) {
    // Dep PATH fired but VALUE identical ⇒ strict no-op. The fresh cached page is still valid.
    // Never force a refetch here; respect staleTime. (Forced refetch is reserved for refetch()/invalidate().)
    return;
  }
  // queryKey value genuinely changed ⇒ different result set:
  p.generation++;                            // supersede any in-flight fetch of the old family
  evictForeignFamilies(p, newKey);           // maxCachedQueries=1 ⇒ drop others + their inFlight promises
  p.currentQueryKey = newKey;
  p.currentPage = p.config.initialPage;
  p.loadedOrdinals = [p.config.initialPage];
  const first = p.families.get(newKey)?.pages.get(p.config.initialPage);
  if (first?.status === "fresh") {           // flipped back to a still-cached filter
    projectWindow(ls); notifyListChanged();  // still NO resolver
  } else {
    this._triggerPagedFetch(ls, p.config.initialPage);
  }
}
```

### `executePagedListResolve` (new file, mirrors `executeListResolve`'s hard-won guards)

1. Compute `queryKeyHash` from live values/context **before** issuing; `fam = getOrCreateFamily(p, hash)`; **set `p.currentQueryKey = hash` at issue time** (so `projectWindow` never reads `families.get(null)` on the bootstrap fetch). Capture in the closure: `issuedKey`, `issuedOrdinal`, `issuedGeneration`, **eager per-path value snapshots of the known dep set** (`resolve.deps ∪ fam.dependencies` — cheap: it is the settled dep set, not the tree), and (infinite+offset) **`expectedOffset`** = the `Σ fetchedCount` continuation counter at issue.
2. **Per-family, per-page dedup — implicit issuance only.** If `fam.inFlight.has(ordinal)` return that promise. (Never the status-based dedup — `setPage(2)` while page 1 loads must not dedup against page 1.) **Explicit issuance (`refetch()`/`invalidate()`) passes `force` and bypasses this branch**, bumps `generation`, and *overwrites* `fam.inFlight.set(ordinal, newPromise)`. Without the exemption the one API that means "give me fresh data now" is a guaranteed no-op whenever a fetch for that ordinal happens to be in flight — it would return the older promise and resolve success-looking with pre-refresh data, while that older completion consumes the `stale` marker the refetch just set.
3. Set root `ResolveState.status = 'pending'` + nodeState loading; notify `{ listNode, listState }`.
4. **No `structuredClone`.** Wrap the **live** `valuesCache.values` in the copy-on-read snapshot proxy (see "Resolver snapshot without structuredClone" below); wrap context via `createContextTrackingProxy` (reused verbatim). Build the shared `ListResolveContext` (the filter block exactly as the shipped `executeListResolve` does, plus `ctx.page` = the `PageRequest`), run the resolver.
5. `const norm = normalize(await resolver(vProxy, storeProxy, req));`
6. **Abort / drift guards — drift is per-accessed-path VALUE equality, never queryKey-string equality, sampled PRE-own-write (before step 7 applies this run's output).** In order: **(a)** `issuedGeneration !== p.generation` → release `inFlight`, no-op. **(b)** over every accessed path (eager dep snapshots ∪ the proxy's copy-on-first-access snapshots), `deepEqual(snapshotValue, getByPath(liveValues, path))` — **excluding self-referential list-slot paths** (a sibling page's projection mid-flight must not read as drift); over `contextTracking.getAccessedKeys()`, `startContext[k] !== liveContext[k]`. **(c) Completion-key gate:** recompute the queryKey from live values over the now-known accessed set; `!== issuedKey` → treat as drift. This closes the **bootstrap race**: a dep edited during run 1 *before* the resolver's first read of it leaves no snapshot delta (the copy was taken post-edit) and no external retrigger fires (auto-deps aren't in `state.dependencies` yet) — without this gate the result would be filed under the stale issue-time key, poisoning the family with another query's rows. **(d)** (infinite+offset) recompute the continuation counter; `!== expectedOffset` (a delete landed mid-flight — invisible to path drift, since `page`/offset is deliberately never a values path) → discard, reissue at the corrected offset. Any confirmed drift: discard and `_retriggerPaginatedList` under the fresh key (the paged analog of `pendingRetrigger`, so a change landing mid-flight is never lost).
7. **Success:** fold accessed paths (and accessed context keys, `$context.`-prefixed) into `fam.dependencies`, and set `state.dependencies = union of all live families' dependencies` (the SELECTION key — see the authoritative statement). Then `setEntitiesRaw(norm.items, listNode)` (reused — upsert bodies + register leaves). **Drop any returned id already present in another fresh page of the same family** (server-driven cross-page dedup) — but **scoped to pages not being replaced by this run**: an ordinal marked `refetching` is excluded from the dedup source. On a reordering feed (the `updated_at desc` default) a row that moved from page 5 to page 2 would otherwise be dropped from the incoming page 2 because the *old* page-5 entry still holds it, and then vanish entirely when page 5 is replaced — silent row loss with every entry reading `fresh`. **A page with un-flushed edits (`ids !== initialIds`) is RECONCILED, never skipped:** `newIds = fetchedIds ⧺ (oldIds ∖ oldInitialIds ∖ fetchedIds)` (locally-added rows re-appended, minus dupes), `initialIds = fetchedIds`, and the **fresh** `nextCursor` always wins. ("Skip" is removed from the design: it would strand an add-before-first-fetch page rendering one optimistic row forever — the page stays guard-dirty, and the refetch that would re-baseline it is the very thing the guard blocks; in cursor mode a skipped page would additionally feed a stale cursor into the chain.) Otherwise `fam.pages.set(issuedOrdinal, { ids, initialIds: [...ids], status: 'fresh', fetchedAt: now, nextCursor })`. Update `fam.serverTotal`; LRU-evict beyond `maxCachedPages` **skipping pinned window ordinals**. **(infinite) `issuedOrdinal` joins `loadedOrdinals` here — on success, never at issue** (a failed fetch must not leave a hole; a retry re-targets the same ordinal).
8. **Projection gate.** paged/cursor: project iff `issuedGeneration === p.generation && issuedKey === p.currentQueryKey && issuedOrdinal === p.currentPage`. **infinite:** iff generation+key match **and** `issuedOrdinal ∈ windowOrdinals(p) ∪ { max(loadedOrdinals)+1 }` (append-then-project) — the paged gate would silently drop an out-of-order `loadMore` completion (double-tap: N+1 resolves after N+2 became current) or an in-window background revalidation, leaving fetched rows invisible in cache. Then `projectWindow(ls)` + `syncListValuesCache` + `notifyListChanged`. Otherwise (prefetch / superseded) just fill cache.
9. **Empty page result ≠ the legacy wipe.** `norm.items.length === 0` stores `{ ids: [], initialIds: [], status: 'fresh' }` under `issuedOrdinal` and records `hasMore = false`; it never touches other pages and never clears the window. (`executeListResolve`'s empty branch wipes `itemIds` AND `initialItemIds` wholesale — in infinite, `[]` is the ordinary end-of-feed signal, and inheriting the wipe would erase the whole accumulated window on the last scroll.)
10. `finally`: **identity-checked release** — `if (fam.inFlight.get(ordinal) === myPromise) fam.inFlight.delete(ordinal)`. An unconditional delete lets a superseded fetch remove the *replacement's* entry: `inFlight.size` hits 0 while a fetch is running, so `isFetching`/`loading` go false, `state.status` is written `'resolved'` mid-flight, and the next fetch of that ordinal stops deduping. (This is a latent defect independent of `force` — it only becomes reachable once any re-issue path exists.) Then, if `fam.inFlight.size === 0`, set `state.status = 'resolved'` (so `loading`/`isFetching` stay true while sibling pages load). Error path mirrors `executeListResolve` (`onError`, notify).

`projectWindow` is mode-agnostic — **one ordinal set feeds BOTH window arrays**:

```ts
function windowOrdinals(p: PaginationState): number[] {
  return p.mode === "infinite" ? p.loadedOrdinals : [p.currentPage];
}

function projectWindow(ls: ListState): void {
  const p = ls.pagination!, fam = p.families.get(p.currentQueryKey!);
  if (!fam) { ls.itemIds = []; ls.initialItemIds = []; return; }
  const ords = windowOrdinals(p);   // every ordinal here is PINNED from LRU eviction
  ls.itemIds        = dedupe(ords.flatMap(o => fam.pages.get(o)?.ids ?? devAssertMissing(o)));
  ls.initialItemIds = dedupe(ords.flatMap(o => fam.pages.get(o)?.initialIds ?? []));
  // syncListValuesCache(ls) called by the caller, unchanged
}
```

The paged case degenerates to today's single-page copy; the infinite case can never pair a multi-page `itemIds` with a single-page baseline (the naive draft did exactly that — after one `loadMore` the window held 40 ids against a 20-id baseline and the list read permanently dirty, leaking into submit/reset). The baseline invariant, restated: **`initialItemIds` derives from the `initialIds` of exactly the ordinals that formed the window — never from `itemIds`.** Setting it from `itemIds` would make an optimistic add invisible to `dirty` after one navigation round-trip. `initialIds` is written at fetch/hydrate/rekey — plus the **promotion rule** (mutations rule 6); write-through touches `ids` only. A missing pinned ordinal is an invariant violation (dev-assert), never a fallback. Note `dirty` itself is per-mode (see Cross-cutting): infinite uses the per-page rollup, because `dedupe` can collapse a cross-page duplicate and make window-level `arraysEqual` lie.

## Resolver snapshot without structuredClone (paged executor only)

**Verified state of the code.** The full-tree clone lives in exactly two consumers — `executeResolve` (3 sites) and `executeListResolve` (2 sites: pre-await tracking base, post-await drift sample), both via `resolveDeps.getValues = () => structuredClone(valuesCache.values)` (`createResolveManager.ts:159`). Entity bodies are **not** duplicated in the live tree: the list slot in `valuesCache` is an array of references to the shared per-entity projection POJOs, one instance each (`palistor.ts:631-661, 680-713`); duplication happens only at clone time. Per-entity resolvers (`executeEntityFieldResolve`, `triggerEntityListResolve`) never call the clone-based `getValues` at all. Blast radius of switching only the paged executor is therefore zero: legacy executors keep their clones, and every legacy drift test stays valid.

For a paginated list the clone is quadratic over an infinite session (loading page k clones all k−1 accumulated pages — twice). The paged executor therefore uses a **copy-on-read tracking proxy over the live `valuesCache.values`** (new file, `createLiveValuesSnapshotProxy`), with four properties that the review established as load-bearing:

1. **Per-path deep-copy at first access, cached.** The get trap deep-copies the accessed value at first access, caches the copy per path (extending the existing `proxyCache` pattern), and serves the cached copy on re-reads. This restores repeatable reads (a path read before and after an internal resolver `await` returns the same value) and mutation containment (`values.tags.push(x)` mutates the copy, not the store). The copies MUST be deep: projection POJOs mutate in place, so a reference "snapshot" would compare equal to the live tree forever and blind the drift check entirely.
2. **Mutation-blocking traps.** The legacy proxy defines only get/set; `delete` and `defineProperty` forward to the target by default — harmless on a clone, corrupting on the live tree. The live-tree proxy adds `deleteProperty`/`defineProperty` traps (buffer-or-reject, same policy as the set trap's `pendingWrites`).
3. **Drift = snapshot-at-access vs live-at-completion**, sampled at the same pre-own-write point the legacy `L124-127` comment mandates, and excluding the list's own slot (see the self-referential rule). Semantics vs the legacy clone pair: equivalent convergence guarantee, slightly *stronger* in practice — a value that changed before the resolver's first read no longer triggers a spurious re-run, because the resolver already used the fresh value.
4. **The bootstrap hole is closed twice.** Copy-on-first-access weakens exactly one case — a dep edited during run 1 *before* its first read (no snapshot delta, no external retrigger). Closure 1: the known dep set (`resolve.deps ∪ fam.dependencies`) is snapshotted **eagerly at issue** (executor step 1) — cheap, it is the settled set; copy-on-first-access covers only genuinely new paths. Closure 2: the completion-key gate (executor step 6c).

Costs become `O(Σ accessed subtrees)` per fetch instead of `O(tree) × 2` — for a well-written paginated resolver that is a handful of filter scalars.

## Cross-cutting behavior

**getValues / valuesCache / persist scope.** `syncListValuesCache(listState)` (`palistor.ts` ~L680) is called after every projection **unchanged** — it materializes the current `itemIds` into the single nodeSlot keyed by `listConfigNode`. Consequently, for a paginated list `getValues()` serializes **the visible window only**; edits on non-visible cached pages are *not* in the submit payload. This is the deliberate Phase-1 scope (server-driven pagination rarely holds the full set client-side) and is **documented, not silent**: whole-list submit of a paginated list yields one page. A per-page `collect()`/flush API that iterates `fam.pages` in ordinal order is provided for the union case (Phase 3). Critically, `PaginationState` (with its Maps) **never enters `valuesCache`** — `resolveDeps.getValues` does `structuredClone(valuesCache.values)`, so pagination state lives on `ListState` only. Per-mode scope is documented: **paged** persists/dirties one page; **infinite** persists/dirties all `loadedOrdinals`; **cursor** persists/dirties the current window.

**Persist (serialize + hydrate).** Infinite persists the **full loaded window** (all `loadedOrdinals`), paged persists the current window; both alongside a pointer blob. Restoring a window that the store will then serve *as if fetched* is the single most dangerous surface in this design — the seed deliberately suppresses the first fetch, so anything wrong in the blob is served indefinitely. Six rules make it safe; **all are mandatory, none are optimizations.**

Blob shape: `{ v, fingerprint: { mode, pageSize, base }, savedAt, currentPage, loadedOrdinals, serverTotal?, deps: [...fam.dependencies], depValues: [[path, value], …], pages: { ordinal → { ids, initialIds, fetchedCount, nextCursor? } }, pendingAdds?: { ordinal, ids }[], entities?: { id → body } }`.

1. **Persist the settled dep set *and its values* — never a bare bootstrap set, never the key hash.** `findResolvesToRetrigger` selects only entries whose `state.dependencies` contains a changed path, and `setContext` emits `$context.<key>` paths that live in the **refined** `fam.dependencies`, not in `resolve.deps`. So a seed that installs only `resolve.deps` is unreachable by context invalidation, while `status: 'resolved'` has already killed the lazy trigger and `staleTime: Infinity` kills revalidation: **a window persisted under tenant A is rendered for tenant B forever, across further reloads.** The seed therefore restores `fam.dependencies`, sets `state.dependencies` to the union of restored families' deps, and **recomputes the hash at seed time through the exact code path `_retriggerPaginatedList` will use** (`fam.queryKeyHash = p.currentQueryKey = computeQueryKey(ls, fam.dependencies, getValues, context)`). Recomputing rather than persisting the hash also makes hash-function and declared-dep changes across deploys a non-issue.
2. **Serve only under a matching key.** Compare the key recomputed from live values/context against the key recomputed from the persisted `depValues`. Equal ⇒ serve. Different — or any restored dep whose live value is absent because `setContext` has not run yet — ⇒ **do not serve**: keep `status: 'idle'` and let the normal first fetch run under the live key. Gate the serve decision behind the existing context-satisfied barrier (`isContextSatisfied` in `_executeEntry`) so a family whose deps include an unset `$context.*` never becomes current.
3. **Hydration must not evict what it just restored.** Hydrate ends in `recomputeAndNotify`, whose `changedPaths` include every restored scalar — e.g. `search`, which is in `resolve.deps` in the plan's own example config. The entry is now `'resolved'` with `search` in `state.dependencies`, so `findResolvesToRetrigger` **selects it** and the divert calls `_retriggerPaginatedList`; the recomputed key differs from a bootstrap-minted one *by construction, with no value changed*, and the "re-key-in-place on widened deps" escape covers widening, not this narrowing — so the whole restored session is evicted and refetched milliseconds after being restored, with a page-1 flash, **on every reload**. Rule 1's recompute-at-seed makes the two keys equal by construction; additionally a `hydrating` flag makes the first post-hydrate notify a key-establishing pass (re-key in place), never an invalidation.
4. **Version + config fingerprint, or discard.** Restored ordinals are integers whose meaning is entirely `(o − base) × pageSize`. A one-line `pageSize: 20 → 50` between deploys silently re-interprets them: in paged mode `setPage(3)` is a cache hit serving rows 41-60 under a "101-150" label; in infinite a later refetch files 50 rows under a 20-row ordinal and the continuation skips 30 server rows. A `base` flip shifts everything by a page; a `mode` flip changes what `loadedOrdinals`/`currentPage` mean. `seedFamilyFromWindow` **drops the whole blob** (falling back to rule 6's synthesized family + a normal fetch) when `v` or any fingerprint field mismatches, or when `v` is absent (pre-pagination snapshot). Three comparisons; converts three silent-corruption paths into one cheap refetch.
5. **Bind the blob to its window, and cover every id it references.** Two independent failure modes. *(a) pick/omit skew:* the reserved-key attachment happens **outside** `filterValues`, so `omit: ['users']` — an entirely reasonable config given a large window — drops the value array but keeps the blob: 800 ids restored with zero bodies, `length` 800 vs `items` `[]`, and permanent (lazy trigger dead, `staleTime` Infinity). The blob is a projection of a field, not sidecar navigation like `__flows`: include it only if its list's array survived `filterValues`, ignore on hydrate if the array is absent, and require `restoredIds.length === |dedupe(Σ page.ids)|` before trusting it. *(b) ghost ids:* `syncListValuesCache` filters out ids with no projection object, so a locally-`remove`d row's body is **not** in the persisted window while its id is still in that page's `initialIds`. After hydrate, `reset()` rolls `ids` back from `initialIds` and puts a bodiless id into the window — `length` 800, `items` 799, drifting further every reload/reset cycle: exactly the `length ≠ items.length` desync the delete rewrite eliminated. Persist bodies for the **union `ids ∪ initialIds`** (the extra ones in the blob's `entities` map, fed through `_setEntitiesRaw` before filing pages), and dev-assert at the end of the seed that every restored id resolves in `EntityRegistry`.
6. **Bootstrap from a window with no family.** When a value array is restored but the blob is absent, incompatible (rule 4), or untrusted (rule 5), synthesize a family: file the restored ids under `initialPage` with `initialIds = [...ids]`, `fetchedCount = ids.length`, `loadedOrdinals = [initialPage]`, `serverTotal` undefined, `status: 'stale'`, and leave the root `ResolveState` **`'idle'`** so the normal first fetch runs and *reconciles* (step 7) rather than replaces. Without this path, mutation inversion has no page to mutate: the infinite `dirty` rollup iterates `loadedOrdinals = []` and reports clean over a populated window, `add()` targets `max([])`, and the first lazy fetch wholesale replaces the user's restored draft.

**Hydrate wins over in-flight.** `seedFamilyFromWindow` bumps `generation` before filing, so any fetch issued pre-hydrate (an eager `lazy: false` list, or a first render that beat the async `driver.getItem`) is a no-op cleanup rather than a completion that re-baselines a restored page or, on an account switch, files the previous account's rows into the restored window under an identical constant-bucket key. `PersistManager.disable()` and a superseded `enable()` must likewise bump the pagination generation and clear families.

**Staleness policy.** Per-page `fetchedAt` is *not* persisted (with a finite `staleTime` every restored page would be stale at once and Phase-2 revalidation would fire up to N concurrent fetches on mount). A single `savedAt` seeds every entry's `fetchedAt`; entries older than `staleTime` are marked `'stale'` but **still served** (stale-while-revalidate). `revalidateOnHydrate?: 'none' | 'first' | 'all'`, default **`'first'`** — one task after paint, revalidate only the first window ordinal. Never `'all'` by default. `list.isStaleFromStorage` lets a UI show "restored from your last session" instead of presenting old data as fresh.

**Cursor continuation is not restorable — and that is the one real cost of cursor-first.** A persisted continuation token is by definition older than the storage round-trip. If the server rejects it, `loadMore` fails forever (truncating invalidation means a chain rebuild is the only repair, and nothing triggers it); if the server *accepts* an offset/watermark-encoding cursor, it returns a semantically wrong window that cross-page dedup quietly papers over. So: persist cursors as an **optimistic hint only**, with `fam.continuationTrust = 'hydrated'`. The first `loadMore` under that flag tries the hint once and, on any error, transparently falls back to rebuilding from the last loaded ordinal (or to the `Σ fetchedCount` offset when the resolver accepts offsets), then clears the flag; if neither is possible, `hasNextPage` reports a distinct `continuationLost` so the UI renders "Reload feed" rather than a button that always fails. Note the asymmetry to document plainly: **offset-infinite restores continuation losslessly; cursor-infinite does not.**

**Un-flushed optimistic adds survive the reload — deliberately, and escapably.** A tmp-id row whose POST died with the tab rehydrates with the same tmp id and can never be rekeyed: its page is `ids !== initialIds` forever, so `dirty` is stuck true (every unsaved-changes guard with it), the reconcile recipe **re-appends the zombie on every subsequent refetch**, display total is permanently +1, and if the POST did succeed server-side the row appears twice. Since this is a form library, the default is still to keep user input: persist them separately as `pendingAdds`, expose `list.pendingAdds` plus a one-time dev warning naming the ids, and ship **`list.discardPendingAdds()`** as the documented escape from the permanent-dirty state. `persistPendingAdds?: 'keep' | 'drop'` makes it a choice rather than an accident.

**Cost, and how it is bounded.** `PersistManager` subscribes globally and `saveToStorage` does `structuredClone` of the whole values tree + `filterValues` + `JSON.stringify` — so with a 40-page window every keystroke in an unrelated field clones ~800 projection POJOs and stringifies ~200 KB at 10 Hz, growing linearly with scroll depth. Worse, `setItem` throws `QuotaExceededError` synchronously and the write sits in a `catch {}`: **the first over-quota save silently disables persistence for the entire form**, at a point determined by how far the user scrolled — so it never reproduces in dev. Mandatory mitigations: `pagination.persist?: false | 'window' | { maxPages: number }` (see open question 2 for the default); `PersistOptions.onError?: (e, phase: 'save' | 'hydrate') => void` called from **both** swallowed catches; on quota failure, one retry with the pagination blob trimmed to the pointer before giving up, so a large list can never take the form's own persistence down with it; suppress autosave while a `refetch` is in flight (symmetric to the existing `isHydrating` guard). Restore cost is bounded the same way: seed page **ids** eagerly (cheap strings) but materialize entity **bodies** only for the ordinals about to be projected, hydrating the rest on demand — `_restoreListsRec` calls `_setEntitiesRaw` per row, so a full 40-page restore is ~10k dynamic leaf registrations in one synchronous task, before first paint, on exactly the low-end devices that accumulated the window slowest.

**dirty.** Per-mode. **paged/cursor:** the getter keeps `!arraysEqual(itemIds, initialItemIds)` — a pure page switch is `dirty === false`, a page carrying an optimistic add/remove stays dirty across navigation. **infinite:** the window-level compare is unsound once `dedupe` collapses a cross-page duplicate (a `rekey` landing on an id already present in another page can read window-equal while a page still carries un-flushed edits), so `dirty` is the exact per-page rollup: `∃ o ∈ loadedOrdinals: !arraysEqual(entry.ids, entry.initialIds)` — same O(window) cost, no dedupe reasoning. Aggregate cross-page dirty for **paged** (edits parked on non-visible pages) stays Phase 3.

**reset.** `resetPipeline.ts` today iterates only `entityRegistry.resetEntityListStates()` (per-entity) — **there is no root-list loop, and root list nodes are skipped by `applyPatch`** (verified: `resetPipeline.ts:23-65`, `applyPatch.ts:33`). Phase 1 adds an explicit iteration over root `ListState`s. For paginated ones reset is a **mode-agnostic per-page rollback — it undoes EDITS, not navigation**: for every cached entry, `entry.ids = [...entry.initialIds]`; `currentPage` / `loadedOrdinals` / families are **kept**; `generation` is bumped (in-flight results discarded); `ResolveState` stays `'resolved'`; `projectWindow` + notify. Zero network, page/scroll position preserved; in infinite mode every loaded ordinal rolls back (window pinning guarantees the entries exist). The earlier draft ("re-seed the `initialPage` family from `initialItemIds`, reset `ResolveState` to `'idle'`") was wrong twice over: `initialItemIds` holds the *current* page's baseline, so resetting from page 3 would file page-3 rows under ordinal 1 — shown as "page 1" and then shown *again* on the real page 3; and flipping to `'idle'` would make the next `items` GET lazy-refetch, violating offline-safe reset.

**rekey(old, new).** `Palistor.rekey` (`palistor.ts` ~L420) calls `entityRegistry.rekey` (which rewrites only the current window via `registeredLists`) and then, unconditionally, `rekeyPagination(ls, old, new)`, which walks **every family and every page**, rewriting both `entry.ids` and `entry.initialIds` (and the window `itemIds`/`initialItemIds`), regardless of `currentQueryKey`/`currentPage`. This reaches a tmp id parked in an off-screen cached page after the user navigated away before the server responded. Rewriting `initialIds` occurrences keeps *fetched* rows from reading as spuriously dirty; for optimistically **added** rows the old id never occurred in any `initialIds`, so occurrence-rewriting alone cannot clear them — the **rekey-promotion rule** (mutations rule 6) inserts the confirmed id into the page's `initialIds` and increments `serverTotal`.

**delete(id).** `Palistor.delete` (`palistor.ts` ~L457) removes the id only from the window today. It is extended to call `deleteIdEverywhere(ls, id)` for every paginated `ListState` in the same loop: splice the id out of **every** `fam.pages.*.ids` and `initialIds` across **all** families, decrement `fam.serverTotal` where the id was server-truth (present in `initialIds`), drop now-empty page entries, and recompute `pageCount`. Without this, `length` (`itemIds.length`) and `items.length` (which filters missing entities via `buildItemProxy`) silently disagree on every off-screen cached page — the exact desync the delete rewrite was built to prevent.

**fieldMapping.** Pagination keys are **not** field-mappable in Phase 1 (they are not in `MAPPABLE_KEYS`), and they are **reserved against collisions in the other direction**: at `Palistor` construction, if any `externalToInternal` target equals a `PAGINATION_SPREAD_KEYS` member, throw with a clear message (otherwise a user renaming `dirty`→`page` would shadow the pagination getter and return a boolean). `isFetching` is a **native pagination getter**, forbidden as a fieldMapping external target; it is not merely "an alias of the mapped `loading`" — shipping both meanings on one string is disallowed.

**Tracking / re-render.** `react/createTrackingProxy.ts` **is on the change list** and its list branch is extended: every reactive pagination getter (`page`, `pageSize`, `pageCount`, `total`, **`serverTotal`**, `hasNextPage`, `hasPrevPage`, `isFetching`, `isInitialLoading`, **`isFetchingNextPage`, `loadedPages`**) does `refs.accessed.add(listState); refs.lastVersions.set(listState, store.getNodeVersion(listState))` exactly like `length`/`loading`/`dirty`. Without this, a Pager reading only `page`/`pageCount` — or a section-header component reading only `loadedPages`, or a footer spinner on `isFetchingNextPage` — subscribes to nothing and never updates (the tracked key set is hardcoded; unknown keys fall through to the untracked forward branch). Pagination **methods** stay in the untracked forward branch. `notifyListChanged()` keeps adding both `listState` and `listConfigNode` to the changed set, so `getNodeVersion(listConfigNode)` tests still pass.

**Per-entity nested lists.** Phase 1 attaches `PaginationState` **only when `ownerEntity === null`** (root), at the `registerNodes.ts` construction site. `getOrCreateEntityListState` (`entityRegistry.ts` ~L233) does **not** allocate `PaginationState` in Phase 1, even when the same config node carries `resolve.pagination`. If a paginated config is instantiated as a nested list, emit a one-time dev warning ("paginated nested lists are Phase 3") so the degraded plain-list behavior is discoverable rather than a silent missing `setPage`. Full nested parity is Phase 3 (below).

**Modes.** All three share `projectWindow` + `executePagedListResolve`. **paged** (Phase 1): window = one page. **infinite** (Phase 2, **cursor-first**): `loadedOrdinals` accumulate (on success only), `loadMore` appends from cache without fetch when the next ordinal is loaded, window = deduped concat over `windowOrdinals`; `currentPage` is derived (`max(loadedOrdinals)`) and never read by projection. **cursor** (Phase 2): pages keyed by ordinal with a parallel `cursors` map, `nextCursor` threaded into `PageRequest.cursor`, `prevPage` always a cache hit; random `setPage(n)` to an unreachable ordinal is sequential-only. **Cursor invalidation is TRUNCATING, not marking:** page k+1's cursor is minted by page k's response, so a refetched page k orphans every cached ordinal > k — their ids may correspond to no reachable server window at all. `invalidate(k)` atomically drops ordinals `> k`, prunes `loadedOrdinals`, **bumps `generation`** (superseding any in-flight continuation fetched off a now-dropped cursor — without the bump its completion passes the write gate and files a 20-row gap into the window), reprojects, notifies. `refetch()` reuses this primitive rather than adding a second mechanism: it is `invalidate(initialPage)` + one fetch (see Methods).

## Local mutations vs the page cache

**Mutation inversion — pages are the source of truth; the window is always a projection.** The earlier draft ("mutate the window, then copy it into the current page") is dropped: in infinite mode the window is a concat of many pages, and copying a 600-id window back into one entry is undefined. Every local mutation mutates the authoritative `PageCacheEntry.ids` first (**never** `initialIds`), then `projectWindow` + `syncListValuesCache` + notify re-derive everything else. The rules:

1. **Placement.** `add()`: paged → the `currentPage` entry; infinite → the **last loaded ordinal's** entry. An over-full page is fine — fullness/continuation math never reads `|ids|`, only `|initialIds|` (fetch-time facts), so a local add cannot fake a "full page". `remove(id)`: locate the entry containing the id — any cached page, call its ordinal **P** — and splice there; the projection re-derives, so visible feedback is immediate even when P is off-screen.

2. **Accounting is derived, never counted.** No stored total is mutated by optimistic edits. `fam.serverTotal` moves only on server-truth events (fetch result, delete of a server row, rekey-promotion). The `total`/`pageCount` getters derive `serverTotal + Σ(|ids| − |initialIds|)`; `hasNextPage` reads only server-truth values. Consequences: an optimistic add can never fabricate a phantom "next page" on a fully-loaded list (the reviewed failure: total-bump → `serverLoadedCount < total` → a "Load more" button on a complete feed → a guaranteed-empty fetch), and there is no counter to double-decrement when a stale page is spliced.

3. **Offset staling is keyed on the splice ordinal P, not `currentPage`** (paged mode). A removal reaching a cached page *before* the visible one shifts the visible page's server offset too: with the old `> currentPage` rule, deleting from cached page 1 while viewing page 3 left pages 2-3 "fresh" with wrong offsets — after persist, a page-1 refetch ends with the row that still heads cached page 2, rendering one row on two pages. Rule: mark every ordinal `> P` stale, including the currently displayed page when `P < currentPage` (it refetches on next visit; its projection stays as-is meanwhile). Infinite mode stales nothing — loaded content is on screen, a background refetch would reflow under the user's scroll; only the continuation point moves (rule 5). A same-length `setItems` (pure replace) skips staling.

4. **Cross-page dedup.** `add()`/`setItems()` dedup against the **whole current family** (`hasIdInFamily(fam, id)`), not just the window — the `buildListProxy` `.includes(entityId)` guard is window-only and would let the same entity land on two cached pages. On a cross-page add, reject (no-op like the registry-missing case) or move the id (removing it from its old page and staling that page's downstream ordinals per rule 3).

5. **Continuation counter (infinite+offset): `nextOffset = Σ fetchedCount` over `loadedOrdinals`** — the server's own row count, not `Σ|initialIds|`. Correct because rekey-promotion increments it (rule 6), `deleteIdEverywhere` decrements it for deleted server rows, un-confirmed optimistic rows never enter it, **and cross-page dedup cannot shrink it** (deriving from `|initialIds|` would break the moment a revalidated page stored fewer ids than the server returned). The in-flight race (a delete lands while a `loadMore` is out; the deleted row shifts server offsets, and nothing else can see it — the offset is not a values path) is closed by the executor's offset gate (step 6d): capture at issue, recompute at completion, mismatch → discard + reissue corrected. *External* server-side drift between fetches remains inherently approximate for offset mode — documented; **cursor mode is the recommended default for infinite** precisely because it has no boundary-drift problem.

6. **Rekey-promotion — the rule that makes the rest sound.** `rekey(tmp, real)` rewrites occurrences in `ids`/`initialIds` across all families and pages (as before), **and additionally: when the old id is present in an entry's `ids` but absent from its `initialIds`, the new id is inserted into `initialIds` at its `ids` position and `fam.serverTotal`/`fetchedCount` increment** — server confirmation makes the row server truth. **Promotion is idempotent and loses to a concurrent fetch commit:** it is skipped when the id is already in `initialIds`, and when the server reports no `total` (the normal cursor case) step 7 reconciles `serverTotal += |fetchedIds| − |oldInitialIds|` rather than trusting accumulated increments. Otherwise a promotion racing a refetch of the same page double-counts permanently — step 7 overwrites `initialIds` with `fetchedIds` (which already contains the confirmed row), discarding the array edit but not the increment, and with no server total nothing ever re-derives it: `hasNextPage` then reports true on a complete feed, producing exactly the guaranteed-empty fetch derived accounting exists to prevent. Without promotion, an optimistic add leaves its page `ids !== initialIds` *forever* (the tmp id never occurred in any `initialIds`, so occurrence-rewriting can't clear it): the page reads permanently dirty though the row is confirmed, the un-reconciled guard blocks every future refetch of it with no path to ever clear (a deadlock — the refetch is the only re-baseline moment and it is the thing being blocked), and the continuation sum undercounts the confirmed row.

7. **Refetch reconciles, never skips.** Executor step 7's recipe (`fetchedIds ⧺ local-adds ∖ dupes`; baseline = `fetchedIds`; fresh cursor wins) is the only sanctioned behavior for refetching a page with un-flushed edits — `staleTime` expiry, `invalidate()` + revisit, and background revalidation all included. Optimistic rows reconcile through `rekey` on server confirmation, not through a full-page refetch.

8. **`setItems()` on an infinite-mode list throws in dev** (warn + no-op in prod). Distributing an arbitrary permutation of a multi-page window back into per-page entries has no correct assignment — any page-boundary split changes which entry's baseline/guard/rekey finds each row, and a later single-page refetch would roll back exactly one slice of the user's ordering. Reorder of a server-ordered infinite window is out of scope. Paged mode: `setItems` replaces the `currentPage` entry's `ids` (family-wide dedup applies).

9. **rekey / delete route through the controller** (see Cross-cutting) so tmp→real id fixes and deletions reach **off-screen** cached pages, keeping `length === items.length` everywhere; `delete` decrements `serverTotal` only when the id was server-truth (present in some `initialIds`).

## Files to change

| File | Change |
|---|---|
| `store/store/types.ts` | Add `PaginationConfig`, `PageMode`; add `pagination?` to `ListResolveConfig`; add `pagination?: PaginationState` to `ListState`; widen `resolver` signature (3rd `page?` arg, `PagedResult` return); add pagination members to `ListProxyNode<T>` (all optional). |
| `store/pagination/types.ts` | **New:** `PageCacheEntry`, `QueryFamily`, `PaginationState` (per-family `inFlight`, `generation`). |
| `store/pagination/paginationController.ts` | **New:** `windowOrdinals`, `projectWindow` (mode-agnostic — both window arrays from the same ordinal set), `computeQueryKey` (self-ref-dep exclusion, `queryKey()` escape hatch), `getOrCreateFamily`, `evictForeignFamilies` (bump generation, drop inFlight), `resetPagination` (per-page rollback, pointer kept, generation bumped), `rekeyPagination` (all families/pages, ids + initialIds, **promotion of confirmed adds into `initialIds` + `serverTotal`**), `deleteIdEverywhere`, `truncateCursorChain` (drop > k, prune `loadedOrdinals`, bump generation), `seedFamilyFromWindow` (set ordinal + total + status=resolved + deps), `hasIdInFamily`, LRU helpers (window-ordinal pinning). |
| `store/resolvePipeline/types.ts` | **New exports:** `PageRequest`, `PagedResult`. |
| `store/resolvePipeline/createLiveValuesSnapshotProxy.ts` | **New:** copy-on-read tracking proxy over the **live** `valuesCache.values` — per-path deep-copy at first access, cached for repeatable re-reads; `set`/`deleteProperty`/`defineProperty` contained; reports accessed paths + snapshots for the drift check. Used only by the paged executor; legacy executors keep the `structuredClone`. |
| `store/resolvePipeline/executePagedListResolve.ts` | **New:** paged executor mirroring `executeListResolve`'s in-flight/abort/auto-dep logic; per-family per-page `inFlight` dedup released in `finally`; `generation`+key+ordinal write gate (infinite: window-membership projection gate + append-on-success); copy-on-read drift check (eager dep snapshots at issue, self-slot excluded) + completion-key gate + offset gate; fold accessed paths into `fam.dependencies` AND `state.dependencies`; cross-page dedup + mandatory reconcile recipe; empty page ≠ wipe. |
| `store/resolvePipeline/index.ts` | Export the new executor + types. |
| `store/defineList.ts` | Add `pagination?: PaginationConfig` to `DefineListConfig.resolve`; thread into `listConfig.resolve`. |
| `store/init/createResolveManager.ts` | `_executeEntry` list branch: config-driven paged vs plain dispatch; add `triggerListPageResolve(ls, n)`, `_triggerPagedFetch`, `_retriggerPaginatedList`; divert paginated entries in the `findResolvesToRetrigger` loop, the second (pending-mark) loop, and `retriggerByPaths` — **after** the `autoRetriggerCount` bump so `MAX_AUTO_RETRIGGERS` still applies; keep the setContext counter reset; thread controller deps into `listResolveDeps`. |
| `store/buildProxy/buildListProxy.ts` | Conditional `spreadKeys` union applied to **both** `LIST_SPREAD_KEYS` and `ENTITY_LIST_SPREAD_KEYS` branches, gated by `if (listState.pagination)`; new gated GET cases (`page`/`pageSize`/`pageCount`/`total`/`serverTotal`/`hasNextPage`/`hasPrevPage`/`isFetching`/`isInitialLoading`/`isFetchingNextPage`/`loadedPages`/`setPage`/`nextPage`/`prevPage`/`loadMore`/`refetch`/`invalidate`); `loading`/`isFetching` re-derived from `fam.inFlight.size`; mutation inversion in `add`/`remove`/`setItems` (mutate the page entry, then project; derived accounting; splice-ordinal staling; `setItems` dev-throw on infinite) + cross-family dedup; synchronous `setPage` no-fetch path. `ownKeys`/`getOwnPropertyDescriptor` consistent with the unioned `spreadKeys`. |
| `react/createTrackingProxy.ts` | Extend the list branch to `refs.accessed.add(listState)` for every reactive pagination getter **including `isFetchingNextPage`/`loadedPages`**; keep methods untracked. |
| `store/constants.ts` | Add `PAGINATION_SPREAD_KEYS`. |
| `store/store/registerNodes.ts` | **Attachment site:** allocate `PaginationState` for root `ListState` when `resolve.pagination` present (`ownerEntity === null`). |
| `store/entityRegistry/entityRegistry.ts` | `getOrCreateEntityListState` does **not** attach `PaginationState` in Phase 1; emit one-time dev warning if `resolve.pagination` appears on a nested-instantiated config; `rekey` path unchanged (window rewrite) — controller handles cache. |
| `store/store/palistor.ts` | Constructor: reserve `PAGINATION_SPREAD_KEYS` against fieldMapping collisions (throw). `restoreLists`: call `seedFamilyFromWindow` (version+fingerprint check, dep-set restore + key recompute, `ids ∪ initialIds` body coverage, generation bump, synthesized-family fallback). `rekey`: call `rekeyPagination` (idempotent promotion). `delete`: call `deleteIdEverywhere` per paginated ListState. `syncListValuesCache` unchanged. |
| `store/persist/persistManager.ts` | Attach the pagination blob **inside** the `filterValues` boundary (bound to its list's array, unlike `__flows`); `PersistOptions.onError?: (e, phase: 'save' \| 'hydrate') => void` called from both currently-swallowed catches; quota retry with the blob trimmed to the pointer; suppress autosave while a refetch is in flight; `pagination.persist` bound (`false \| 'window' \| { maxPages }`); `revalidateOnHydrate`; `disable()`/superseded `enable()` bump every paginated `generation` and clear families. |
| `store/resetPipeline/resetPipeline.ts` | Add root-`ListState` iteration; for paginated lists `resetPagination(ls)` = per-page rollback (`entry.ids = [...entry.initialIds]`), pointer kept, generation bumped, `ResolveState` stays `'resolved'` — zero network, no re-filing under a wrong ordinal. |

## Phasing

**Phase 1 — Minimal no-refetch-on-cached-page for ROOT lists, paged mode (the core deliverable).**
`PaginationState` sidecar on root `ListState` (attached in `registerNodes.ts`, `ownerEntity === null` only); two-level `families → pages` cache with `maxCachedQueries: 1`; per-family/per-page `inFlight` + monotonic `generation`; `windowOrdinals`-based `projectWindow` with the same-ordinals baseline invariant; new `executePagedListResolve.ts` with the copy-on-read snapshot proxy (`createLiveValuesSnapshotProxy` — no `structuredClone`), the abort/drift/completion-key gates, writing to both `fam.dependencies` and `state.dependencies`; config-driven dispatch in `_executeEntry`; `_retriggerPaginatedList` diverted into both postNotifyHook loops + `retriggerByPaths` after the `autoRetriggerCount` bump (queryKey recompute → re-key-in-place on widened deps / no-op on unchanged value / evict + reset-to-page-1 + serve-cached-or-fetch on changed value); the synchronous `setPage` cache-hit path; getters `page/pageSize/pageCount/total/serverTotal/hasNextPage/hasPrevPage/loading/isFetching/isInitialLoading` (loading/isFetching from `inFlight.size`); methods `setPage/nextPage/prevPage/refetch/invalidate`; `createTrackingProxy` extension; `PAGINATION_SPREAD_KEYS` reservation; mutation inversion (pages authoritative → project) with derived accounting + cross-family dedup; `rekeyPagination` (with confirmed-add promotion), `deleteIdEverywhere`, `resetPagination` (root loop, per-page rollback, pointer kept), `seedFamilyFromWindow` on hydrate with status=resolved to suppress lazy refetch; empty page ≠ wipe. **Outcome:** switching to an already-loaded page runs a synchronous `projectWindow + notify` and never enters the resolve pipeline; a filter/search/context change invalidates the old query and refetches page 1 exactly once; `executeListResolve` and all non-paginated lists are byte-for-byte unchanged.

**Phase 2 — Richer modes & cache lifecycle.**
`infinite` mode, **cursor-first** (`loadMore` targeting `max(loadedOrdinals)+1` with append-on-success, window-membership projection gate, pinned window ordinals, `isFetchingNextPage`/`loadedPages`, per-page dirty rollup, offset-continuation gate for offset mode; row-proxy identity is already stable across appends — verified: `ListState → listProxyCache → per-list entityProxyCache → EntityNode`, upsert merges in place — so `React.memo` rows bail out correctly); `cursor` mode (`cursors` map, `nextCursor` threading, free `prevPage`, truncating invalidation, hydrated-cursor fallback); **targeted root recompute for list notifications** (verified feasible: a root list sources to group path `""` and groupDeps edges cover cross-group readers of the slot; inherits targeted recompute's documented lazy-edge-discovery gap; flip `notifyListChanged`'s root branch and the executor's completion recompute together — without it every `loadMore` is a full-tree recompute); `prefetch(n)` (hover/next-page warmup without moving the pointer); `keepPreviousData`/`isPreviousData`; finite `staleTime` background revalidation (honoring the reconcile recipe); multi-family retention (`maxCachedQueries > 1` + `gcTime`) so flip-back-to-old-filter is also cache-served; `setPageSize`; the infinite persist blob with its six safety rules (default scope = open question 2).

**Phase 3 — Per-entity lists & completeness.**
Refactor `triggerEntityListResolve` (`createResolveManager.ts` ~L324, which dedups on `status === 'pending'||'resolved'` with no deps-driven re-resolve) to route page fetches through the shared paged executor (per-page dedup, queryKey retrigger), giving nested paginated lists full parity; aggregate cross-page `dirty` for paged (per-page baselines + rollup); optional persistence of the whole page cache / pointer; optional EntityRegistry refcount GC on family/page eviction; **sliding-window head truncation for very long infinite sessions** (`maxPages` analog — the only sanctioned way a window ordinal leaves memory; truncated pages must leave a tombstone `|initialIds|` count so the continuation offset survives — see open question 4); **display-level boundary reflow for paged deletes** (projection borrows the next page's head without writing any entry — the write-through variant was evaluated and rejected: borrowed rows land in `ids` but not `initialIds`, turning every downstream page permanently guard-dirty); suspense integration.

## Decision ledger (2026-07-19)

Carried over unchanged from the first round: base 1 (configurable); `loading` = any-fetch from `inFlight.size` + `isInitialLoading`; `maxCachedQueries: 1` in Phase 1; pagination keys not field-mappable + reserved (construction throw); `staleTime: Infinity`; entity bodies stay in `EntityRegistry` on eviction (refcount GC only if real, Phase 3); cursor random access sequential-only.

Resolved this round (verification + adversarial review; each folded into the body above):

- **`windowOrdinals` projection** — both window arrays from the same ordinal set; Phase 1 (the paged-only shape would have shipped a latent infinite-dirty bug).
- **Mutation inversion** — page entries authoritative, window always a projection; kills the window→page write-back decomposition problem before it exists.
- **Derived accounting** — `serverTotal` (server-truth only: fetch, delete-of-server-row, rekey-promotion) + derived local delta `Σ(|ids|−|initialIds|)`; `hasNextPage` immune to optimistic mutations; no stored counters to drift or double-decrement.
- **Rekey-promotion** of confirmed adds into `initialIds` — without it: permanent page-dirty, un-reconciled-guard deadlock, continuation undercount.
- **Reconcile, never skip** on refetching an edited page (recipe in executor step 7); "skip" deadlocks add-before-first-fetch and poisons cursor chains.
- **Infinite is cursor-first**; offset continuation counter + issue/completion offset gate (the counter later refined to `Σ fetchedCount` — see round 3); external server drift documented as approximate in offset mode.
- **Truncating cursor invalidation** (`invalidate(k)` drops `> k`, prunes `loadedOrdinals`, bumps `generation`) — later reused verbatim as `refetch()`'s infinite implementation.
- **Window ordinals pinned from LRU**; a missing pinned ordinal is a dev-assert, not a fallback.
- **`loadMore` targets `max(loadedOrdinals)+1`**; ordinal joins on success; concurrent `loadMore` no-ops; `currentPage` is derived in infinite.
- **Infinite projection gate** = window membership ∪ next ordinal (append-then-project) — the paged gate drops out-of-order completions.
- **Reset = per-page rollback** (edits, not navigation); pointer kept; `ResolveState` stays `'resolved'`; generation bumped. The re-seed-under-`initialPage` draft mis-filed pages and triggered a lazy refetch.
- **Per-page dirty rollup** in infinite (window `arraysEqual` lies under `dedupe` collapse); window compare stays for paged.
- **`setItems` dev-throws on infinite lists** — no correct page-boundary split of an arbitrary permutation exists.
- **Splice-ordinal staling** (paged): stale ordinals `> P` where P received the removal — `> currentPage` left fresh pages with wrong offsets when P was off-screen.
- **Paged boundary write-through reflow rejected** (poisons every downstream baseline → guard deadlock); display-level reflow is a Phase-3 nicety.
- **No-clone snapshot proxy ships in Phase 1** inside the new executor: the executor is new code, the legacy path is byte-for-byte untouched (verified: exactly two clone consumers, both legacy), and retrofitting the drift logic later would churn it. Empty-page ≠ wipe likewise Phase 1.
- **Root `ListState` identity is never recreated** — verified load-bearing (hub tracking key, `listProxyCache` key, dispatch handle); `resetPagination`/hydrate mutate fields on the same object. Row-proxy identity across appends is stable for free (`EntityNode` merged in place), so `React.memo` rows bail out correctly.

Resolved in round 3 (after the `refetch`/persist attack):

- **`refetch()` is always exactly ONE request** — paged: whole family stale + current page; infinite: `invalidate(initialPage)` + fetch, reusing truncating invalidation. A chain refetch (re-fetch every loaded ordinal, preserving the window) was designed and **rejected**: it had no atomicity (a mid-chain 502 splices two server snapshots into one window with an unmarked boundary, and the only consistent repair destroys the rest of the scroll session *and* the un-flushed rows parked on it), its "parallel for offset mode" premise was false (prefix offsets are mutually dependent once any row count changes) and turned the step-6d gate into a self-sustaining reissue storm, its cross-page dedup dropped rows that had merely moved between pages on a reordering feed, its re-entrancy corrupted cursors via superseded in-flight legs, `inFlight` drained between legs so `isFetching` strobed and `state.status` flipped `'resolved'` mid-refresh, and it persisted torn intermediate windows that hydrate as `'resolved'` and never self-correct. **Killing the chain closed that entire cluster at once** — which is also why no `isRefetching` getter is needed. The expensive variant stays reachable later as `refetch({ pages: 'loaded' })`, self-documenting about its cost.
- **`force` issuance** (`refetch`/`invalidate`): bypasses the in-flight dedup, bumps `generation`, overwrites the `inFlight` entry. Without it the "fresh data now" API is a guaranteed no-op whenever a fetch is already in flight.
- **Identity-checked `inFlight` release** — a latent false-drain/leak independent of `force`.
- **Run-scoped cross-page dedup** — pages being replaced are excluded from the dedup source (`'refetching'` status), else a row that moved between pages vanishes.
- **`fetchedCount` on `PageCacheEntry`** — the continuation counter is `Σ fetchedCount`, not `Σ|initialIds|`, so dedup shrinking a page cannot shift every later offset.
- **Idempotent, fetch-loses-to-commit rekey-promotion** — a promotion racing a page refetch otherwise inflates `serverTotal` permanently (cursor mode has no server total to re-derive from).
- **Persist has six mandatory safety rules** (settled deps + values, key recompute at seed, serve-only-under-matching-key with a context barrier, hydration-doesn't-evict, version+fingerprint-or-discard, blob bound to its window with `ids ∪ initialIds` body coverage, synthesized-family bootstrap). Two of the three criticals here were *silent wrong-data* paths — a tenant-A window served to tenant B forever, and hydration deterministically evicting its own restored session on every reload.
- **Hydrate bumps `generation`** (restored data wins over any pre-hydrate in-flight fetch); persist `disable()`/`enable()` clear paginated families.
- **`revalidateOnHydrate: 'first'` by default**; single `savedAt`, stale-but-served, never `'all'`.
- **Cursor continuation is a hint, not state** (`continuationTrust: 'hydrated'`, fallback rebuild, `continuationLost`); documented asymmetry — offset-infinite restores continuation losslessly, cursor-infinite cannot.
- **`pendingAdds` + `discardPendingAdds()`** — un-flushed optimistic adds survive reload by default (form library), with a named escape from the otherwise-permanent dirty state.
- **Persist failures are surfaced, not swallowed** (`onError` on both catches, quota retry with the blob trimmed) — today the first over-quota save silently kills persistence for the whole form.

## Open questions (new round)

**Settled:** full-window infinite persist is supported (Q1 — but see Q2 below on the *default*); a single `refetch()`, no `refetchAll()` (Q2 of the previous round, implemented as exactly one request per call — see the round-3 ledger); both `total` and `serverTotal` getters (Q3).

1. **Sliding-window head truncation (Phase 3) — deferred by request, kept here so its constraints survive the deferral.** Day-long infinite sessions grow monotonically (entities, projection POJOs, node leaves are never evicted; `delete(id)` is the only eviction path and it is O(#lists × window)). Adopt a react-query-style `maxPages` dropping ordinals from the *head* of `loadedOrdinals`? Known constraints: truncated pages must leave a **tombstone `fetchedCount`** or the continuation offset breaks; reset's rolled-back window would no longer equal the full history; window-ordinal LRU pinning makes head truncation the *only* sanctioned way a window ordinal leaves memory; and `refetch()`'s "truncate to `initialPage`" would have to become "truncate to `min(loadedOrdinals)`", since `initialPage` may itself have been dropped.
2. **Default for `pagination.persist` — blocks freezing the Phase-2 blob.** Q1 settled *that* the full window is persistable. The attack pass argues the **default** should nonetheless be bounded, on three grounds: per-save cost is O(window) on every global notify (a 40-page window clones ~800 POJOs and stringifies ~200 KB per keystroke in an unrelated field); the first over-quota `setItem` silently kills persistence for the entire form, at a scroll depth that never reproduces in dev; and — the strongest point — **the stated benefit is not actually delivered**, because hydration lands after first paint, so the browser has already clamped scroll restoration to 0 against an empty document and the user scrolls back manually regardless. **Recommend `{ maxPages: 3 }` as the default** (restores a usable tail plus the correct dirty/reset baseline), with `'window'` as the documented opt-in. Choosing `'window'` as the default only makes sense together with Q3.
3. **Scroll anchor API.** Persist an anchor (`anchorId` = first visible row, set via `list.setScrollAnchor(id)` or an IntersectionObserver) and expose `list.scrollAnchor` after hydrate? Without it, full-window persist pays every cost and still lands the user at the top. **Recommend yes if Q2 picks `'window'` as the default; otherwise ship it alongside the opt-in.**
4. **`refetch()` on infinite drops to page 1 — confirm the UX.** Pull-to-refresh semantics, and the only O(1)-request option, but it does discard scroll depth. The window-preserving alternative is exactly the chain refetch the ledger rejected on correctness grounds. **Recommend as specified**, with `refetch({ pages: 'loaded' })` available later for apps that accept the cost. Flagged because it is user-visible behavior, not an internal invariant.
5. **Dev warning on self-slot reads.** *(Independent of the `refetch`/`refetchAll` question — this one is about a resolver reading its own list.)* Reading the list's own materialized slot inside its resolver deep-copies the whole window through the live snapshot proxy, and the read is excluded from both the queryKey and the drift set. Warn once in dev when the snapshot proxy sees it, pointing at the `page` argument instead? **Recommend yes** — cheap, and it turns a silent perf/semantics trap into a visible one.

## Test plan

1. **Cache hit = 0 fetches.** Load page 1, `setPage(2)` (fetch), `setPage(1)` → assert resolver call count unchanged, `items`/`page` reflect page 1, no `queueMicrotask`/await taken.
2. **Auto-dep change resets & refetches once.** Resolver reads `values.search` with `resolve.deps` empty; type in search → assert `findResolvesToRetrigger` selects the entry (proves `state.dependencies` got the auto-dep), old family evicted, `currentPage === base`, exactly one resolver call.
3. **`$context` dep change via `setContext`.** Change `tenantId` → assert `retriggerByPaths` selects and resets to page 1; counter reset to 0.
4. **Unchanged-value dep notify is a strict no-op.** Set `search` to the same string / notify a sibling tracked path → assert **zero** resolver calls, cached page still served (proves no forced refetch, staleTime respected).
5. **Re-key-in-place on first-run dep widening.** First fetch refines auto-deps; assert the family is renamed, not evicted, and no spurious second fetch fires on the next read.
6. **Race: A→B mid-flight.** Start page-1 fetch under A; change filter to B before it resolves; when the stale A promise completes assert it writes nothing (generation guard), its `inFlight` entry is released (no leak), and B fetched exactly once.
7. **Race: A→B→A rapid.** Two fetches both carrying `key=A, ordinal=1`; assert the superseded (older generation) one no-ops and does not overwrite the newer family's page.
8. **Concurrent page fetches + loading.** `setPage(2)` then `setPage(3)` before 2 returns; page 3 resolves first → assert `isFetching` stays true while page 2 loads, flips false only when `inFlight` drains.
9. **First-run drift correctness.** Change an auto-dep (not in `resolve.deps`) during the very first fetch → assert per-accessed-path value compare detects it and reroutes, no thrash loop.
10. **Cycle guard.** Self-referential paginated resolver (`A→A` each completion) → assert it caps at `MAX_AUTO_RETRIGGERS` with a warning, not unbounded.
11. **Bootstrap projects.** Fresh lazy mount → assert `currentQueryKey` is assigned at issue time and the first page renders (never `families.get(null)` → empty).
12. **Persist round-trip = cache hit.** Serialize on page 2, hydrate → assert window filed under ordinal 2, `total` restored, `ResolveState.status === 'resolved'`, and first render triggers **zero** refetch.
13. **dirty survives navigation.** `add(x)` on page 1 (dirty=true), `nextPage()`, `prevPage()` → assert still dirty (baseline from `initialIds`, not re-based from `ids`).
14. **Reset rolls back edits, not navigation.** Navigate to page 3, edit, `reset()` → assert still on page 3, every cached entry's `ids` restored from its `initialIds`, zero resolver calls, `ResolveState` stays `'resolved'`, and the next `items` GET does **not** lazy-refetch. (The old expectation — re-seed under `initialPage`, status idle — is the reviewed mis-filing bug.)
15. **delete parity.** Delete an entity present in cached page 3 while viewing page 1; visit page 3 → assert `length === items.length === getValues().length`, `total` decremented.
16. **Cardinality drift.** `remove()` a row on page 1 with pages 2,3 cached → assert pages 2,3 marked stale and refetched on visit (no dup/gap at the boundary), `total` decremented, `pageCount` recomputed.
17. **Background refetch preserves unsaved add.** Optimistic `add()` on page 1, trigger a `staleTime`/`invalidate` refetch of page 1 → assert the optimistic row is not clobbered.
18. **Cross-page dedup.** `add(x)` on page 1 where x already sits in cached page 3 → assert reject/move (x never on two pages); server page fetch returning an already-present id drops the duplicate.
19. **rekey reaches off-screen pages.** Optimistic `add()` on page 1 → `nextPage()` → `rekey(tmp, real)` → `prevPage()` → assert real-id row present and dirty state preserved (`initialIds` rewritten).
20. **Tracking.** A component reading only `page`/`pageCount` (not `items`/`map`) re-renders on `setPage`; a spinner bound to `isFetching` clears when `inFlight` drains.
21. **fieldMapping collision.** Construct with an `externalToInternal` target equal to a pagination key → assert construction throws.
22. **spread/ownKeys consistency.** `Object.keys(list)` / `{...list}` include the pagination keys for a paginated list and are byte-for-byte unchanged for a non-paginated one.
23. **Backward-compat.** A non-paginated list: assert `LIST_SPREAD_KEYS`, `ownKeys`, GET set, `executeListResolve` behavior, `getNodeVersion(listConfigNode)` versions, and resolver call counts are identical to pre-change baseline; no `PaginationState` allocated.
24. **Backward-compat resolver shape.** A paginated resolver returning a bare array → normalized to `{ items }`, caches and paginates via the loaded-page heuristic.
25. **Nested paginated warning.** A `resolve.pagination` config instantiated as a per-entity nested list → assert one-time dev warning and plain-list (non-paginated) behavior, no `setPage`.
26. **Rekey-promotion.** Optimistic `add()` → `rekey(tmp, real)` → assert the page's `ids === initialIds` (guard unblocked), page not dirty, `serverTotal` +1, and (infinite+offset) the next `loadMore` offset counts the confirmed row.
27. **Bootstrap race → completion-key gate.** Edit an auto-dep during run 1 *before* the resolver's first read of it → assert the result is discarded and re-filed under the fresh key — never stored under the stale issue-time key.
28. **Sibling projection ≠ drift.** `setPage(2)` + `setPage(3)` concurrently with a resolver that reads its own list slot → assert no livelock (self-slot excluded from drift), both pages land, `MAX_AUTO_RETRIGGERS` untouched; one-time dev warning on the self-slot read.
29. **Snapshot proxy semantics.** A path read before and after an internal resolver `await` returns the same (copied) value; `values.tags.push(x)` inside the resolver does not mutate the store; `delete proxy.foo` is contained; a mid-flight edit of an eagerly-snapshotted dep is detected as drift.
30. **`loadMore` failure safety.** Failed fetch → `loadedOrdinals` unchanged, retry targets the same ordinal (no skipped page); a second `loadMore` while one is in flight no-ops; `isFetchingNextPage` true during, false after.
31. **Out-of-order infinite completion.** Two `loadMore`s resolve out of order → assert the earlier ordinal still appends and projects via the window-membership gate (no invisible cached page).
32. **Truncating invalidation supersedes orphan continuation.** Cursor-infinite, `loadMore(4)` in flight off page 3's cursor; `invalidate(2)` → assert the completion no-ops (generation), `loadedOrdinals` pruned to ≤ 2, window reprojected without gaps.
33. **LRU pinning.** `maxCachedPages < |loadedOrdinals|` → assert no window ordinal is ever evicted (off-window/foreign pages evict normally); dev-assert fires if a pinned ordinal is missing at projection.
34. **`hasNextPage` immune to optimistic edits.** Fully loaded infinite list (`Σ fetchedCount === serverTotal`) → `add()` → assert `hasNextPage` stays false and `total` (display) still +1; an empty page result stores `{ids: []}` + `hasMore=false` and touches no other page (no legacy wipe).
35. **Reconcile recipe.** Refetch a page holding an optimistic add → assert fetched rows + re-appended local row, `initialIds = fetchedIds`, fresh `nextCursor` stored; infinite `dirty` (per-page rollup) still true, and stays detectable when `dedupe` collapses a cross-page duplicate.
36. **Mid-flight delete corrects the offset.** Infinite+offset, `loadMore` in flight, `delete(id)` of a loaded server row lands → assert the completion is discarded and reissued at the corrected offset (no one-row gap at the boundary).
37. **Splice-ordinal staling.** Viewing page 3 with pages 1-4 cached, `remove(id)` living in cached page 1 → assert pages 2, 3, 4 marked stale (not just 4), and no row is served on two pages after the page-1 refetch.
38. **`setItems` on infinite throws.** Dev-throw (prod warn + no-op), state untouched.
39. **`refetch()` is one request.** paged: whole family marked stale, exactly one fetch, siblings refetch on visit (and a server-side head insert never renders one row on two pages). infinite: `loadedOrdinals === [initialPage]` after the call, exactly one fetch, local-only rows from dropped pages harvested onto the surviving page.
40. **Forced issuance beats the dedup.** `refetch()` while a fetch for that ordinal is in flight → assert a *new* request is issued, the old completion writes nothing (generation), `refetch()`'s promise settles on the new run, and `inFlight` is released by identity (never draining while a fetch is live).
41. **Run-scoped dedup.** Reordering feed: a row moves from cached page 5 into the refetched page 2 → assert it survives (the not-yet-replaced page-5 copy is excluded from the dedup source) and never appears twice.
42. **Continuation immune to dedup.** Revalidate ordinal 1 against a server that prepended rows so the page stores fewer ids than were returned → assert the next `loadMore` skips and repeats nothing (`Σ fetchedCount`, not `Σ|initialIds|`).
43. **Promotion × refetch race.** Optimistic add → `rekey` promotion lands while that page's refetch is in flight → assert `serverTotal` is counted once and `hasNextPage` is false on a complete feed.
44. **Hydrate does not evict itself.** Persist a 40-page window with `deps: ['search']` and a persisted `search` value → hydrate → assert zero resolver calls after the hydrate notify settles and `loadedOrdinals` intact.
45. **Hydrate under a different context does NOT serve.** Save under `tenantId: 'A'`, hydrate with `tenantId: 'B'` (both orderings: `setContext` before and after hydrate) → assert the restored window is never rendered and exactly one fetch runs under the live key.
46. **Config fingerprint discard.** Change `pageSize` (and separately `base`, and `mode`) between save and hydrate → assert the blob is dropped, `loadedOrdinals === [initialPage]`, exactly one fetch. Absent `v` (pre-pagination snapshot) → the synthesized-family bootstrap path, `ResolveState` idle, first fetch reconciles rather than replaces.
47. **`omit` skew and ghost ids.** `omit: ['users']` with a pagination blob present → assert the blob is ignored (never `length` 800 vs `items` 0). Locally `remove()` a server row, save, hydrate, `reset()` → assert `length === items.length === getValues().length` (no bodiless id resurrected).
48. **Hydrate beats in-flight.** Eager (`lazy: false`) list whose page-1 fetch is in flight when hydration lands → assert the restored window wins and the completion writes nothing; `persist.disable()`/re-`enable()` clears families so no cross-key completion survives an account switch.
49. **Pending adds survive and are escapable.** `add()` → save → hydrate → assert the tmp row is present exactly once, `list.pendingAdds` names it, a dev warning fired, refetching the page twice does not duplicate it, and `discardPendingAdds()` clears `dirty`.
50. **Persist failures surface.** Force `QuotaExceededError` → assert `onError('save')` fires, the retry drops the pagination blob to the pointer, and the form's own fields still persist. Corrupt the stored JSON → assert `onError('hydrate')` fires rather than silently hydrating nothing.
51. **`revalidateOnHydrate: 'first'`.** Hydrate a multi-page window past `staleTime` → assert entries are marked stale but served, exactly one revalidation (the first window ordinal) fires after paint, and `isInitialLoading` never becomes true.
52. **Cursor continuation lost.** Hydrate a cursor-infinite window, first `loadMore` rejects the restored cursor → assert the transparent fallback rebuild runs, and if it cannot, `continuationLost` is reported rather than a Load-more button that fails forever.
