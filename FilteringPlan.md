# List Filtering — Design Plan

Palistor lists today have no notion of a filter. An app that wants to filter a list keeps the filter state outside the store (a React context, `useState`) and applies pure functions to the resolved array — see `store/filteringExample.md`, lifted verbatim from a real consumer, whose own `TODO` reads *"в Палистор нужно добавить фильтры в апи списков, и эта логика не понадобится"*. That split is not just boilerplate: the store resolves the data but does not know which subset it is actually showing, so `length`, membership `dirty`, and (once `PaginationPlan.md` lands) `total`/`hasNextPage` all describe a set the user never sees.

This plan makes the filter a **first-class part of the list**: a declared block of ordinary Palistor fields (values *and* derived/computed values) that lives on the `ListState`, is reactive like any other field, is handed to the resolver as an explicit argument, and participates in invalidation exactly like a dependency. Two execution modes are supported from Phase 1 — **server** (filter values become resolver params; the server does the filtering) and **client** (a declared predicate projects the loaded membership) — because both are real and the state layer underneath them is identical.

The design is deliberately parallel to `PaginationPlan.md`: an optional sidecar on `ListState`, additive `if (listState.filter)`-gated branches in `buildListProxy`, zero bytes changed for a list without a `filter` block. Where the two plans touch (resolver signature, queryKey, page reset) this document states the joint rule and flags the one amendment `PaginationPlan.md` needs.

## Core idea

A filter is **owned by exactly one list**. That single fact removes most of the machinery pagination needed: there is no path-matching guesswork about "which resolver cares about this change" — a filter field change invalidates its own list, directly and precisely.

Three pieces:

1. **State.** Filter fields are declared inside the list config and registered as **ordinary Palistor leaf nodes** (`registerNodes`), with a real slot in `valuesCache` under a reserved root key `$filters.<listPath>.<field>`. They therefore get, for free and with no new code: computed props (`label`, `isVisible`, `isDisabled`, …), **derived values** (`value: (values) => …` is already supported — `store/compute/recompute/recomputeLeaves.ts:33`), validation, per-node notification, tracking-proxy subscriptions, and dep-path addressability.
2. **Application.** `mode: "server"` folds the filter values into the resolver call and into invalidation. `mode: "client"` applies declared per-field predicates as a **read-time projection** over `itemIds` — the membership itself is never rewritten.
3. **Surface.** Two proxies with one boundary between them: **`list.filter` carries controls, `list` carries data.** `list.filter.brand` is a full field proxy bindable to an input, `list.filter.values` is a snapshot of the *filter's own* values, plus `set` / `reset` / `clear` / `isActive` / `activeCount` / `isPending`. The rows never appear there: `list.values` / `list.items` / `list.map` / `list.length` are the **visible** set, `list.fullLength` the loaded one, `list.getValues()` the form payload.

The reserved `$filters` slot is the one genuinely new concept, and it exists to buy the whole compute/notify pipeline unchanged. Its boundary rule is single and strict: **`$filters` is view state, not form data** — it is stripped from `getValues()`, never reaches the submit payload, and is not touched by `store.reset()`. (Precedent: `__flows` in `store/persist/persistManager.ts:30`.)

## Author-facing API

`filter` sits at the top level of `defineList`, **not** inside `resolve` — a list with no resolver can still be filtered client-side.

```ts
// store/store/types.ts
export type FilterMode = "server" | "client";

export interface FilterConfig<TEntity = any> {
  /** Filter fields — ordinary leaf configs (value may be a function → derived). */
  fields: Record<string, AnyConfigNode>;
  /**
   * Inferred as "client" iff `where` is declared, else "server". An explicit
   * `mode` always wins; `where` alongside `mode: "server"` is a dev throw
   * (predicates that look live but are dead code).
   */
  mode?: FilterMode;
  /**
   * Client mode: per-field predicate. Skipped automatically when the field's
   * value isEmpty (store/compute/isEmpty.ts). Keys must exist in `fields`.
   * Declaring `where` is also what infers `mode: "client"`.
   */
  where?: Partial<Record<string, (item: TEntity, value: any) => boolean>> & {
    /** Cross-field rule, ANDed after the per-field ones. Always runs. */
    $all?: (item: TEntity, filterValues: Record<string, unknown>) => boolean;
  };
  /** Server mode: shape the resolver params. Default: the filter values object. */
  toParams?: (filterValues: Record<string, unknown>, context: Record<string, unknown>) => unknown;
  /** ms to debounce INVALIDATION (never the field value itself). Default 0. */
  debounce?: number;
  /** Persist filter values (opt-in — filters are view state). Default false. */
  persist?: boolean;
}
```

```ts
vehicles: defineList<Vehicle>({
  template: { id: { value: "" }, name: { value: "" }, brand_id: { value: "" } },

  filter: {
    fields: {
      search:   { value: "", debounce: 300, placeholder: (t) => t("vehicles.search") },
      brand:    { value: null as string | null, label: (t) => t("vehicles.brand") },
      category: { value: [] as string[] },
      // derived field — recomputed by the existing compute pipeline
      isNarrowed: { value: (v) => Boolean(v.$filters.vehicles.brand) },
    },
    mode: "server",
    toParams: (f) => ({ q: f.search, brand_id: f.brand, categories: f.category }),
  },

  resolve: {
    resolver: async (values, store, ctx) => api.vehicles({ ...ctx.filter.params, ...ctx.page }),
  },
})
```

Client mode over an already-loaded list — the direct replacement for `store/filteringExample.md`:

```ts
filter: {
  // `mode: "client"` is inferred from the presence of `where` — spelled out here only for the reader
  fields: { search: { value: "" }, brand: { value: null }, category: { value: [] } },
  where: {
    brand:    (v, brand) => v.brand_id === brand,
    category: (v, cats: string[]) => cats.some((c) => (v.category ?? []).includes(c)),
    search:   (v, q: string) => [v.name, v.model, v.brand_name, v.plateNumber]
                                  .some((s) => s?.toLowerCase().includes(q.toLowerCase())),
  },
}
```

Note what disappears: every `if (!filter) return items` guard, every empty-array early return, and the `hasActiveFilters` helper — emptiness is decided once by the existing `isEmpty` and exposed as `filter.isActive`.

**Rules for `fields`.**
- Same config vocabulary as any leaf, normalized through the same `fieldMapping` pass as the rest of the config (`store/normalizeConfig.ts`) — filters are authored in external names like everything else.
- A **derived** field (`value` is a function) is read-only: `recomputeLeaves` overwrites it on every recompute. Writing one is a dev-mode throw, not a silent no-op.
- Nested groups inside `fields` are allowed (they are just groups); lists inside `fields` are not (dev throw).
- `excludeFromActive?: boolean` on a field keeps it out of `isActive` / `activeCount`. It is the escape hatch for a field with a **non-empty default** (`type: { value: "car" }`), which is otherwise permanently "active" — exactly the field `filteringExample.md` skips by hand in `hasActiveFilters`.

### Resolver contract — the one cross-plan amendment

`PaginationPlan.md` currently specifies `resolver(values, store, page?: PageRequest)`. Two independent third arguments cannot both exist, so **both plans adopt a single context object**:

```ts
// store/resolvePipeline/types.ts
export interface ListResolveContext {
  filter: { values: Record<string, unknown>; params: unknown; key: string };
  page?: PageRequest;               // PaginationPlan
  sort?: SortRequest;               // reserved seam, see Non-goals
  queryKey: string;
  signal?: AbortSignal;             // reserved seam
}
resolver: (values, store, ctx: ListResolveContext) => Promise<Array<Record<string, unknown>> | PagedResult>
```

`ctx` is passed **always** (never `undefined`), with `filter.values = {}` / `filter.params = undefined` on a list with no filter block, so a resolver never needs an existence check. Neither plan is implemented yet, so this costs one edit in `PaginationPlan.md` (§ Author-facing API, § Resolver contract, § `executePagedListResolve` step 1) and nothing in shipped code. **`values` (arg 1) keeps its meaning: form values with `$filters` stripped** — the filter is reachable only through `ctx`, so there is exactly one way to read it.

## Consumer-facing API

Gated on `listState.filter`; a list without a filter block keeps `LIST_SPREAD_KEYS` / `ENTITY_LIST_SPREAD_KEYS` byte-for-byte identical (the same both-branches rule pagination uses).

### The boundary: `filter` holds controls, the list holds data

No list row is ever reachable through `list.filter`, and no filter control through `list.*`. Three reasons, in ascending order of weight:

1. **The `filter.*` namespace belongs to the author.** Its keys are filter *field names* (`search`, `type`, `status`), so every builtin is a subtraction from the author's vocabulary. `values`/`set`/`reset`/`clear`/`isActive`/`activeCount`/`isPending` is already the whole budget; adding `items`/`length`/`map`/`getById` would roughly double the collision surface in the one place where names are user-chosen.
2. **One proxy would carry two subscription sources.** `filter.brand` subscribes the reading component to that field's leaf node; a `filter.items` would have to subscribe it to the `ListState`. Mixing them on one object is a trap in `react/createTrackingProxy.ts`, where the subscription is chosen by the read.
3. **Render code must not know the mode — decisive.** In `mode: "server"` there is no projection at all: the server already returned the filtered rows, so `filter.items` would be *identical* to `list.items`. A list that graduates from client to server filtering — the exact migration this plan expects when a list outgrows the client ceiling — would then break every component that rendered through `filter`. `list.map` / `list.length` mean "what this list is showing" in both modes, so the markup is written once.

### `list.filter` — a FilterProxy of controls

| Member | Meaning |
|---|---|
| `filter.<field>` | full field proxy (`value`, `label`, `isVisible`, `onValueChange`, …) — bindable to an input exactly like `form.name` |
| `filter.values` | plain snapshot of the **filter's own** values (derived fields included) — never list rows; this is the shape `toParams` and the Phase 2 URL helpers consume |
| `filter.set(patch)` | bulk write; one notify, one invalidation |
| `filter.reset()` | back to declared defaults |
| `filter.clear(key?)` | clear one field (or all) to its **empty** value, not its default |
| `filter.isActive` | any non-derived field is non-empty (`store/compute/isEmpty.ts`), skipping fields marked `excludeFromActive` — replaces hand-written `hasActiveFilters` |
| `filter.activeCount` | how many such fields — the badge on a "Filters" button |
| `filter.isPending` | a debounced change is queued but not yet issued (server mode) |

`isActive` is **emptiness, not difference-from-default.** The alternative (active = differs from declared default) reads well until `filter.clear()`: a field defaulting to `"car"`, cleared to `null`, differs from its default and would keep the badge lit right after the user pressed "Clear all". A set filter is a non-empty filter; the non-empty-default case is handled by `excludeFromActive` on that one field instead of by a global rule.

### The list proxy — visible by default, full by explicit name

| Key | Returns |
|---|---|
| `list.values` | **visible** item proxies — the render entry point: `list.values.map(v => <input {...v.name} />)` |
| `list.items`, `list.map(fn)`, `[Symbol.iterator]` | the same visible set (`items` is the pre-existing spelling of `values`; `map` is `values.map`) |
| `list.length` | size of the visible set |
| `list.fullLength` | size of the full loaded membership |
| `list.getValues()` | **full** plain values — form data and submit payload |
| `list.getById`, `list.dirty`, `add` / `remove` / `setItems` | full membership |

The short names mean *what the list is showing*; the full membership is reachable only by asking for it in as many words. In server mode, and whenever the filter is inactive, visible === full and every row above agrees — the divergence exists only under an active client-mode predicate.

There is deliberately **no `matchCount` / `sourceCount`**: `length` and `fullLength` already are those two numbers, and a third spelling of a count is how UIs end up displaying the wrong one. `"{list.length} of {list.fullLength}"` is the "12 of 340" line.

The one consequence to document loudly: under an active client filter `list.getValues().length !== list.length`, and `values.<list>.length` (form data, full) disagrees with `list.length` (view, visible). That is the split being made legible rather than hidden — a submit that silently dropped rows because a UI control was set is data loss, while a count that needs the word `full` in front of it is a lookup.

The whole surface in one component — and the same JSX works under either mode:

```tsx
const list = store.vehicles;

<Toolbar>
  <input {...list.filter.search} />
  <Select {...list.filter.brand} />
  <Badge count={list.filter.activeCount} />
  <button onClick={() => list.filter.clear()} disabled={!list.filter.isActive}>Clear</button>
  {list.filter.isPending && <Spinner />}
</Toolbar>

<Counter>{list.length} of {list.fullLength}</Counter>
{list.length === 0 && list.filter.isActive && <NothingFound />}

{list.values.map((v) => (
  <Row key={v.id.value}>
    <input {...v.name} />
    <button onClick={() => list.remove(v.id.value)}>×</button>
  </Row>
))}
```

`FILTER_SPREAD_KEYS` is reserved against `fieldMapping` collisions in the `Palistor` constructor (construction throw), the same rule pagination applies to its keys. `values` and `fullLength` additionally join `LIST_ONLY_KEYS`, so they are matched against the **raw** key before `externalToInternal`: `value` is a mappable key, so a `fieldMapping` renaming anything *to* `values` would otherwise rewrite `list.values` into a miss returning `undefined` — the trap documented for `error` at `store/constants.ts:228`.

## Internal model

```ts
// store/filtering/types.ts (new)
export interface FilterState {
  config: FilterConfig;
  mode: FilterMode;
  /** field key → config node (the leaf registered in nodeState/valuesCache). */
  fieldNodes: Map<string, object>;
  /** Dep paths of the filter fields: `$filters.<listPath>.<field>`. */
  paths: Set<string>;
  /** Stable hash of the CURRENT filter values — the memo/invalidation key. */
  key: string;
  /** Hash the resolver last ran with (server mode). */
  issuedKey: string | null;
  /** Debounce handle + the key waiting behind it. */
  pendingKey: string | null;
  pendingTimer: ReturnType<typeof setTimeout> | null;
  /** Client mode memo: valid while (key, listStateVersion) are unchanged. */
  memo: { key: string; version: number; ids: string[] } | null;
}
```

`ListState` gains one optional field: `filter?: FilterState`. Root `ListState` identity is never recreated (a load-bearing invariant per `PaginationPlan.md`'s ledger) — `FilterState` is mutated in place.

**Values slot.** `registerNodes` (`store/store/registerNodes.ts:153`, the `isListNode` branch) registers `listConfig.filter.fields` as a group under path `$filters.<listPath>`, and `buildValuesCache` gets the matching branch creating `values.$filters.<listPath> = {}` before it stamps the list's own `[]`. Both walks already have the list branch to hang this on. Nested lists (`ownerEntity !== null`) do **not** allocate a `FilterState` in Phase 1 — a one-time dev warning, exactly as pagination does.

**`filter.key`** is `stableStringify` over the non-derived field values in sorted key order. Derived fields are excluded: they are pure functions of values already in the key, so including them is redundant and would make an author's `Date`-flavored derivation thrash the cache.

## Invalidation model (server mode)

The whole point of declared filters: **the dep set is known before run 1**. Pagination's bootstrap problem (auto-deps only exist after the first successful fetch, so the first queryKey is formed from an incomplete set and must later be re-keyed in place) does not exist for filter paths.

1. At registration, `FilterState.paths` is unioned into `ResolveState.dependencies` — so the existing `findResolvesToRetrigger` (`store/resolvePipeline/findResolvesToRetrigger.ts`) and `retriggerByPaths` select this list on a filter change with no new selection logic.
2. For paginated lists, `FilterState.paths` is *also* seeded into the bootstrap `QueryFamily.dependencies`, so `computeQueryKey` is correct on the very first fetch and the "re-key-in-place on widened deps" path is never entered for a filter field.
3. A filter change therefore follows the path pagination already specifies for a queryKey change: **evict the foreign family, reset the pointer to `base`, exactly one fetch.** Resetting to page 1 on a filter change is mandatory, not a nicety — page 7 of the old result set is meaningless in the new one.
4. Non-paginated lists take the plain existing route: notify → `changedPaths` → `findResolvesToRetrigger` → `executeListResolve` re-run, with the auto-retrigger counter (`MAX_AUTO_RETRIGGERS`) still applying.

**Debounce is on invalidation only.** `filter.search.value` updates synchronously on every keystroke — the input never lags, computed props and client-mode projection see it immediately. What is debounced is the *issue*: `pendingKey` is set, `filter.isPending` reads true, and on the trailing edge, if `pendingKey !== issuedKey`, the invalidation runs. A `filter.set()` or `reset()` flushes any pending timer first. Without this, a 300 ms-typed query fires one request per character and the last-arriving response is not necessarily the last-typed one.

**Race safety** rides on the mechanisms already designed: the executor captures `issuedKey` in its closure and drops a completion whose key no longer matches the live one, the same way it drops a stale `generation` or ordinal.

**Predicates are never part of the key.** `where` and `toParams` are static config; only *values* form the key. A predicate closing over external mutable state is undetectable and unsupported — documented, not guarded.

## Client mode: filtering is a projection, never a mutation

`itemIds` stays the **full** resolved membership. The filter produces `visibleIds` at read time, memoized on `(filter.key, ListState version)`. This mirrors pagination's mutation-inversion decision — one authoritative store, everything visible derived from it — and it is what keeps membership `dirty` honest: filtering must not make a list dirty.

The split, stated once, exhaustively:

| Reads the **visible** projection | Reads the **full** membership |
|---|---|
| `values`, `items`, `map`, `[Symbol.iterator]`, `length` | `getValues()`, `fullLength`, `dirty`, `getById`, `values.<list>` / `valuesCache`, submit payload, persist, `add`/`remove`/`setItems` |

Rationale for the two non-obvious rows: **`getById` is identity lookup, not a view concern** — an edit dialog opened from a row must not break because the row was just filtered out from under it. And **`getValues()` is the form's value, which is the whole list** — a filtered payload would silently drop rows the user never chose to remove, which is data loss caused by a UI control. `getValues()` is therefore the one read whose name is short but whose meaning is "full"; it earns the exception by being the submit path, and the plain-values snapshot of what is on screen is `list.values.map(v => v.getValues())`.

**Locally added ids bypass the predicate.** An id present in `itemIds` but not in `initialItemIds` is always visible. Without this, `list.add({...})` under an active filter makes the new row vanish at the instant it is created — the single most confusing thing this feature could do. The exemption is exactly the local-delta-vs-server-truth split pagination already uses for accounting, and it ends at the next resolve, which rewrites `initialItemIds`.

**Client filtering + pagination is a dev throw in Phase 1.** Pages are server-truth windows; predicating them client-side yields short pages, a `total` that lies, and a `hasNextPage` that cannot be derived from anything. The legitimate combination is `mode: "server"`. (Phase 2 revisits *filter-the-loaded-window* semantics for infinite mode, where it is at least definable.)

## Cross-cutting behavior

- **`getValues()` strips `$filters`** (`store/store/palistor.ts:367`) — one delete on the structuredClone. Consequently the resolver's `values` proxy does not see filters either, which is intended: `ctx.filter` is the one way in.
- **`store.reset()`** does not touch filters: `resetPipeline` walks `rootConfig`, and `walkFull` hands lists to `onList` without descending (`store/traversal/walkFull.ts:49`), so filter nodes are outside its reach by construction. `filter.reset()` is the explicit, separate verb. This is a decision, not an accident — resetting a form should not wipe the user's search.
- **Persist** is opt-in per list (`filter.persist: true`) and writes under a reserved `__filters` blob keyed by list path, alongside `__flows`. Hydration writes values, recomputes `filter.key`, and — critically — sets `issuedKey = key` **only** when the list's own resolve state is also being restored under the same key; otherwise a restored filter would be displayed while the list shows unfiltered server rows. Restored filters are stripped if the config's field set no longer matches (version/fingerprint discard, same rule as the pagination blob).
- **submit** is unaffected: `submitPipeline` walks the config tree, which never enters the list's `filter` block.
- **`react/createTrackingProxy.ts`**: reading any `filter.*` field subscribes to that field's leaf node; reading `filter.isActive`/`activeCount`/`isPending` subscribes to the `ListState`. On the list side, the **visible** reads (`values`, `items`, `length`, `map`) must subscribe to the filter fields as well as to the `ListState` — in client mode their result is a function of both, so a component that renders `list.values` re-renders on a keystroke in `filter.search` without ever reading the filter. `fullLength`, `getValues()` and `getById` subscribe to the `ListState` only. Methods stay untracked, matching the existing list-proxy convention.
- **Per-entity lists**: no `FilterState` in Phase 1 (dev warning), Phase 3 for parity — the same staging pagination uses, for the same reason (`triggerEntityListResolve` needs its dedup reworked first).

## Non-goals (with reserved seams)

**Sorting is not in this plan**, but it is the same family — list-owned state that must reach the resolver and must invalidate — so `ctx.sort` is reserved in the resolver contract from day one and `SORT_SPREAD_KEYS` is reserved against `fieldMapping` at the same time as the filter keys. Adding a `sort` block later is then additive, not breaking. Likewise reserved: `ctx.signal` (resolver cancellation), and filter **option sources** (a filter field whose choices are themselves resolved from the server — a `resolve` block on a filter field, which the existing per-field entity resolver machinery is already shaped for).

## Files to change

| File | Change |
|---|---|
| `store/store/types.ts` | Add `FilterMode`, `FilterConfig`; `filter?: FilterConfig` on `ListConfig`; `filter?: FilterState` on `ListState`; widen `resolver` to `(values, store, ctx: ListResolveContext)`; add `filter` / `values` / `fullLength` to `ListProxyNode<T>` (optional); `values` is typed as the item-proxy array, i.e. the same type as `items`. |
| `store/filtering/types.ts` | **New:** `FilterState`. |
| `store/filtering/filterController.ts` | **New:** `computeFilterKey` (stable hash, derived fields excluded), `buildFilterParams` (`toParams` or identity), `applyClientFilter` (per-field predicates skipped on `isEmpty`, `$all` last, local-add exemption, memoized on `(key, version)`), `resetFilter`, `clearFilter`, `isFilterActive`/`activeCount` (non-empty, `excludeFromActive` and derived fields skipped), `resolveFilterMode` (`where` ⇒ client, explicit wins, throw on `where` + `"server"`), `scheduleFilterInvalidation` (debounce + flush). |
| `store/filtering/registerFilterNodes.ts` | **New:** register `filter.fields` as a group at `$filters.<listPath>`; reject nested lists and writes to derived fields (dev throw). |
| `store/defineList.ts` | Accept `filter?: FilterConfig` and thread it into `listConfig.filter`; node shape `[template, listConfig]` unchanged. |
| `store/store/registerNodes.ts` | List branch (`:153`): allocate `FilterState` for root lists, call `registerFilterNodes`, record `paths`. |
| `store/valuesCache/valuesCache.ts` | List branch: create the `values.$filters.<listPath>` object before stamping the list's `[]`. |
| `store/normalizeConfig.ts` | Normalize `listConfig.filter.fields` through the same external→internal pass as the rest of the config. |
| `store/buildProxy/buildListProxy.ts` | `if (listState.filter)`-gated: `filter` GET returning the FilterProxy; new `values` GET (visible item proxies) and `fullLength` GET; `items`/`length`/`map`/iterator (`:298`, `:304`, `:342`, `:368`) route through `applyClientFilter` in client mode; `getValues` (`:346`), `getById` (`:336`), `dirty` (`:326`), `add`/`remove`/`setItems` keep reading full membership; union `FILTER_SPREAD_KEYS` into **both** spread-key branches with matching `ownKeys`/`getOwnPropertyDescriptor`. |
| `store/buildProxy/buildFilterProxy.ts` | **New:** field proxies (reuse the leaf-proxy path) + `values`/`set`/`reset`/`clear`/`isActive`/`activeCount`/`isPending`. |
| `store/resolvePipeline/types.ts` | **New export:** `ListResolveContext` (`filter`, `page`, `sort`, `queryKey`, `signal`). |
| `store/resolvePipeline/executeListResolve.ts` | Build and pass `ctx`; capture `issuedKey` in the closure and drop a completion whose key no longer matches (alongside the existing `status !== "pending"` abort); union `FilterState.paths` into `state.dependencies` on both success and error paths. |
| `store/init/createResolveManager.ts` | Seed `FilterState.paths` into `ResolveState.dependencies` at init (so run 1 and `findResolvesToRetrigger` are correct); route filter-field changes to the owning list directly instead of by path match; honor the debounce gate before issuing. |
| `store/store/palistor.ts` | Constructor: reserve `FILTER_SPREAD_KEYS` (+ `SORT_SPREAD_KEYS`) against `fieldMapping` collisions (throw). `getValues()`: strip `$filters`. |
| `store/constants.ts` | Add `FILTER_SPREAD_KEYS`, reserve `SORT_SPREAD_KEYS`; add `values` and `fullLength` to `LIST_SPREAD_KEYS` (`:198`); extend `LIST_ONLY_KEYS` (`:228`) with `filter`, `values`, `fullLength` — all three must be matched raw, before `externalToInternal` translation (`value` is a mappable key, so `values` is genuinely exposed to the same trap `error`/`reload` hit). |
| `store/persist/persistManager.ts` | `__filters` blob (opt-in, per list, fingerprint-or-discard); hydration sets `issuedKey` only under a matching restored resolve state. |
| `react/createTrackingProxy.ts` | Subscribe on filter field reads and on the filter aggregates; in client mode, subscribe the visible list reads (`values`/`items`/`length`/`map`) to the filter fields too. |
| `PaginationPlan.md` | Amend the resolver signature to the shared `ctx` object; note that declared filter paths seed `QueryFamily.dependencies` and so skip the bootstrap re-key. |

## Phasing

**Phase 1 — the filter as list state, both modes, root lists.**
`FilterConfig`/`FilterState`; `$filters` values slot + `registerFilterNodes`; the `filter` proxy with fields, `set`/`reset`/`clear`, `isActive`/`activeCount` (+ `excludeFromActive`); the list-proxy split `values`/`items`/`map`/`length` (visible) vs `fullLength`/`getValues()`/`getById`/`dirty` (full); derived fields via the existing compute pipeline; `ctx` resolver contract; mode inference from `where`; server mode (`toParams`, dep seeding, one-fetch invalidation, page reset under pagination, debounce + `isPending`, `issuedKey` completion gate); client mode (per-field predicates with `isEmpty` skipping, `$all`, memoized projection, local-add exemption, the visible/full split table); `getValues()` strip; `fieldMapping` reservation; client-mode-with-pagination dev throw; nested-list dev warning. **Outcome:** `store/filteringExample.md` deletes entirely; a filter change causes exactly one resolver run; membership `dirty` and the submit payload are unaffected by filtering.

**Phase 2 — lifecycle and ergonomics.**
`filter.persist` (`__filters` blob with the fingerprint rule); URL sync helpers (`filter.toQuery()` / `filter.fromQuery()`) — the single most-repeated piece of app code around any filter UI, deliberately held back from Phase 1 because it needs its own pass on array serialization, router-agnosticism and the interaction with `persist`, and because `filter.values` + `filter.set()` already let an app bridge it by hand; filter presets (`filter.apply(named)`); `keepPreviousData` interaction (show the old rows greyed while the new filter loads, instead of a flash of empty); filter-the-loaded-window semantics for infinite pagination, if it survives its own design pass.

**Phase 3 — completeness.**
The `sort` block on its reserved seam; per-entity (nested) list filters, after `triggerEntityListResolve` is routed through the shared executor; filter fields with their own `resolve` (server-driven option lists); resolver cancellation via `ctx.signal`.

## Decision ledger

- **`filter` is top-level in `defineList`, not inside `resolve`** — a resolver-less list is still filterable, and client mode is precisely that case.
- **Filter fields are real leaf nodes with a `valuesCache` slot**, not an opaque POJO. This is what buys derived values, computed labels, validation, notification and tracking with zero new pipeline code; the cost is one reserved values namespace.
- **Reserved namespace `$filters.<listPath>`, stripped from `getValues()`/submit, untouched by `store.reset()`** — filters are view state. Any placement inside the list's own `values` slot was rejected: that slot is an array, so extra properties do not survive `structuredClone`/`JSON.stringify` and would silently vanish from persist.
- **One `ctx` object as the resolver's third argument**, shared with pagination — two plans cannot each own arg 3. Costs one edit in `PaginationPlan.md`, nothing in shipped code.
- **Declared filter paths seed the dep set before run 1** — filters have no bootstrap gap, and under pagination they make the very first `queryKey` correct, bypassing the re-key-in-place dance.
- **Filter change resets pagination to `base`** — page 7 of the previous result set has no meaning in the new one.
- **Debounce delays invalidation, never the field value** — the input stays synchronous; `isPending` exposes the gap.
- **Client filtering is a read-time projection; `itemIds` is never rewritten** — otherwise every filter interaction flips membership `dirty` and corrupts the reset baseline. Same inversion pagination adopted.
- **`list.filter` carries controls only; rows are read from the list** — the filter's key space belongs to the author, one proxy must not mix two subscription sources, and above all render code must be mode-agnostic: in server mode a `filter.items` would be indistinguishable from `list.items`, so the client→server migration would break every component that used it.
- **Short names are the visible set, the full membership is spelled out: `length` / `fullLength`** — `length` must agree with what `map` renders (in server mode it trivially does), so making it disagree in client mode would give one read two meanings. No `matchCount`/`sourceCount`: a third spelling of a count is how a UI displays the wrong one.
- **`list.values` is the visible item proxies** (an alias of `items`, and what `map` iterates), so a filtered list is rendered — and edited — through one entry point.
- **`getValues()` and the submit payload read full membership; `getById` too** — form data and identity lookups must not be view-dependent, or a filter control silently deletes rows on submit. The resulting `getValues().length !== length` is documented, not smoothed over.
- **`isActive` is emptiness, not difference-from-default** — otherwise `clear()` on a field with a non-empty default leaves the badge lit immediately after "Clear all". The non-empty-default case is a per-field `excludeFromActive`, not a global rule.
- **Both `reset()` (to defaults) and `clear()` (to empty) exist** — they differ only for a field with a non-empty default, which is exactly the case every consumer otherwise hand-writes.
- **`mode` is inferred `"client"` iff `where` is declared, else `"server"`; an explicit `mode` wins** — and `where` alongside `mode: "server"` throws, because dead predicates that look live are worse than a missing default.
- **The client-mode memo ships keyed on `(filter.key, list version)`** — a whole-list re-predicate on any membership change or entity edit. The ceiling (order of a few thousand rows) is documented; past it the answer is `mode: "server"`, which is the same population that needs server paging anyway. Per-field partial invalidation is a Phase 2 option, not a Phase 1 cost.
- **Locally added ids bypass the client predicate until the next resolve** — an optimistic add must not vanish on creation.
- **Client mode + pagination throws in Phase 1** — short pages, a lying `total`, an underivable `hasNextPage`.
- **Only values form the filter key; predicates never do** — functions are neither serializable nor comparable.
- **Derived filter fields are read-only and excluded from the key** — `recomputeLeaves` owns their value, and they are a pure function of values already in the key.
- **`filter` goes in `LIST_ONLY_KEYS`** — a `fieldMapping` renaming something to `filter` would otherwise rewrite `list.filter` into a miss returning `undefined`, the exact trap documented for `error` at `store/constants.ts:228`.

## Open questions

The five questions this plan opened (two `clear`/`reset` verbs, `isActive` semantics, default `mode`, whether `length` follows the projection, and the client-mode cost ceiling) are **settled** and folded into the Decision ledger above. What is left is one naming wart and one placement call:

1. **The word `values` means two different things.** On a list, `list.values` is the visible **item proxies** (bindable, editable). On a filter, `filter.values` is a **plain snapshot** of the filter's own values — the analogue of `getValues()`, not of `items`. The asymmetry is defensible (a filter's individual proxies are already addressed as `filter.<field>`, so a proxy array there would have no consumer, while a list's rows have no other address) but it is a thing to learn. The alternatives are `filter.getValues()` — consistent, but then `filter.values` sits unused and inviting — or renaming the list's to `list.visible`, which loses the short-name-is-the-common-read property. **Recommend as specified**, with the asymmetry stated in the doc-comment on both.
2. **Where `excludeFromActive` lives.** It is spec'd as a per-field config key, which means it travels through `normalizeConfig` with everything else and is unavailable to a `fieldMapping` rename. The alternative is a filter-level list (`activeIgnores: ["type"]`), which keeps the field configs pure leaf configs and reads as one statement about the badge. **Recommend the per-field key** — it stays next to the default that causes the problem — but this is cheap to move before Phase 1 and expensive after.

## Test plan

- **State layer:** filter fields register at `$filters.<listPath>`; derived fields recompute on dependency change; a write to a derived field throws in dev; `fieldMapping` normalizes filter field configs; a `fieldMapping` colliding with a filter key throws at construction.
- **Boundaries:** `getValues()` contains no `$filters`; `store.reset()` leaves filter values untouched; `submit()` payload excludes filters and includes the **full** membership under an active client filter; `list.filter` exposes no list data (`filter.items`/`filter.length`/`filter.map` are `undefined`, and a filter field *named* `items` resolves to that field); persist writes `__filters` only when opted in and discards a blob whose field fingerprint changed.
- **Server mode:** a filter change triggers exactly one resolver run and the resolver receives `ctx.filter.params` from `toParams`; N rapid changes under `debounce: 300` produce one run; `isPending` is true across the gap; a completion whose `issuedKey` is stale is dropped; the auto-retrigger cap still applies.
- **Client mode:** predicates skip empty fields; `$all` runs last; `values`/`items`/`length`/`map`/iterator are filtered while `dirty` stays false across every filter permutation; `getValues()`, `fullLength`, `values.<list>` and `getById` stay full (a filtered-out row is still found by id and still in the payload); `list.values` items are writable proxies whose edits notify normally; `length === fullLength` whenever the filter is inactive and in every server-mode case; a row added under an active non-matching filter stays visible until the next resolve, then disappears; the memo is not recomputed when nothing relevant changed, and *is* recomputed after `add`/`remove`/entity edit.
- **Mode inference and activity:** `where` without `mode` yields client; no `where` yields server; an explicit `mode` wins; `where` with `mode: "server"` throws. `isActive`/`activeCount` count non-empty non-derived fields; a field with a non-empty default is active until marked `excludeFromActive`; both `reset()` and `clear()` end with `isActive === false`, and they differ observably only on a field with a non-empty default.
- **Pagination interplay** (once Phase 1 of `PaginationPlan.md` exists): a filter change evicts the family, resets to `base`, and issues exactly one fetch; the bootstrap `queryKey` already includes filter values on run 1; `mode: "client"` on a paginated list throws.
- **Non-regression:** a list with no `filter` block has an identical `ownKeys`/spread/GET set, and `executeListResolve` behaves byte-for-byte as today apart from receiving a `ctx` whose `filter.values` is `{}`.
- **Port `store/filteringExample.md`** to the new API as an integration test and assert identical output to the original pure functions over the same fixture — the acceptance criterion for deleting that file.
