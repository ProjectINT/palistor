# List Filtering — Design Plan

Palistor lists today have no notion of a filter. An app that wants to filter a list keeps the filter state outside the store (a React context, `useState`) and applies pure functions to the resolved array — see `store/filteringExample.md`, lifted verbatim from a real consumer, whose own `TODO` reads *"в Палистор нужно добавить фильтры в апи списков, и эта логика не понадобится"*. That split is not just boilerplate: the store resolves the data but does not know which subset it is actually showing, so `length`, membership `dirty`, and (once `PaginationPlan.md` lands) `total`/`hasNextPage` all describe a set the user never sees.

This plan makes the filter a **first-class part of the list**: a declared block of ordinary Palistor fields (values *and* derived/computed values) that lives on the `ListState`, is reactive like any other field, is handed to the resolver as an explicit argument, and participates in invalidation exactly like a dependency. There is **no filter-level mode**: each field is, by itself, either a **server field** (its value becomes a resolver param — the Relay model, where filter values are the identity of the loaded set) or a **client field** (it declares a `where` predicate and projects the loaded membership at read time). The one classification rule is per-field and syntactic: **a field with `where` is client, a field without it is server** — so a list can freely mix a server-side `search` with a local `onlyNew` toggle, and the state layer underneath both is identical.

The design is deliberately parallel to `PaginationPlan.md`: an optional sidecar on `ListState`, additive `if (listState.filter)`-gated branches in `buildListProxy`, zero bytes changed for a list without a `filter` block. Where the two plans touch (resolver signature, queryKey, page reset) this document states the joint rule and flags the one amendment `PaginationPlan.md` needs.

## Core idea

A filter is **owned by exactly one list**. That single fact removes most of the machinery pagination needed: there is no path-matching guesswork about "which resolver cares about this change" — a filter field change invalidates its own list, directly and precisely.

Three pieces:

1. **State.** Filter fields are declared inside the list config and registered as **ordinary Palistor leaf nodes** (`registerNodes`), with a real slot in `valuesCache` under a reserved root key `$filters.<listPath>.<field>`. They therefore get, for free and with no new code: computed props (`label`, `isVisible`, `isDisabled`, …), **derived values** (`value: (values) => …` is already supported — `store/compute/recompute/recomputeLeaves.ts:33`), validation, per-node notification, tracking-proxy subscriptions, and dep-path addressability.
2. **Application.** A **server field** (no `where`) folds its value into the resolver params and into the request identity (`serverKey`). A **client field** (`where` declared) applies its predicate as a **read-time projection** over `itemIds` — the membership itself is never rewritten, and the field is *excluded* from `serverKey`, so changing it never issues a request.
3. **Surface.** Two proxies with one boundary between them: **`list.filter` carries controls, `list` carries data.** `list.filter.brand` is a full field proxy bindable to an input, `list.filter.values` is a snapshot of the *filter's own* values, plus `set` / `reset` / `clear` / `isActive` / `activeCount` / `isPending`. The rows never appear there: `list.values` / `list.items` / `list.map` / `list.length` are the **visible** set, `list.fullLength` the loaded one, `list.getValues()` the form payload.

The reserved `$filters` slot is the one genuinely new concept, and it exists to buy the whole compute/notify pipeline unchanged. Its boundary rule is single and strict: **`$filters` is view state, not form data** — it is stripped from `getValues()`, never reaches the submit payload, and is not touched by `store.reset()`. (Precedent: `__flows` in `store/persist/persistManager.ts:30`.)

## Author-facing API

`filter` sits at the top level of `defineList`, **not** inside `resolve` — a list with no resolver can still be filtered client-side (that is precisely a filter block whose every field has `where`).

The common case is a plain object, Relay-style:

```ts
vehicles: defineList<Vehicle>({
  template: { id: { value: "" }, name: { value: "" }, brand_id: { value: "" } },

  // 90% case: filter values ARE the resolver params
  filter: { search: "", brand: null as string | null, category: [] as string[] },

  resolve: {
    resolver: async (values, store, ctx) => api.vehicles({ ...ctx.filter.params, ...ctx.page }),
  },
})
```

A **literal** default expands to `{ value: literal }`. The discriminator is the one the whole codebase already stands on — `"value" in node` (`store/traversal/nodeClassifier.ts:22`): a plain object **with** a `value` key is a field config, anything else (primitive, array, object without `value`) is a literal default. A field that needs more is an ordinary leaf config, with three filter-specific keys on top of the usual vocabulary:

```ts
filter: {
  search:  { value: "", debounce: 300, placeholder: (t) => t("vehicles.search") }, // server field
  brand:   { value: null, param: "brand_id", label: (t) => t("vehicles.brand") },  // server, renamed param
  onlyNew: { value: false, where: (item, v) => item.isNew },                       // client toggle — never issues a request
  // derived field — recomputed by the existing compute pipeline, read-only
  isNarrowed: { value: (v) => Boolean(v.$filters.vehicles.brand) },
}
```

```ts
// store/store/types.ts — sketch; exact typing rides the fieldMapping typed-config work
export type FilterFieldConfig<TEntity> = AnyConfigNode & {
  /**
   * Client predicate: keep `item` iff it returns true. Declaring `where` makes
   * this a CLIENT field: excluded from serverKey, params and resolver deps.
   * Skipped automatically while the field's value isEmpty (store/compute/isEmpty.ts).
   */
  where?: (item: TEntity, value: any) => boolean;
  /** Server param name for this field's value (default: the field key). */
  param?: string;
  /** ms to debounce the INVALIDATION this field's changes cause (never the value). */
  debounce?: number;
};

export type FilterBlock<TEntity> = {
  [field: string]: Literal | FilterFieldConfig<TEntity>;
  /** Cross-field client rule, ANDed after the per-field `where`s. Always runs. */
  $all?: (item: TEntity, filterValues: Record<string, unknown>) => boolean;
  /** Escape hatch: shape ALL server params at once (overrides per-field `param`). */
  $toParams?: (filterValues: Record<string, unknown>, context: Record<string, unknown>) => unknown;
  /** Persist filter values (opt-in — filters are view state). Default false. */
  $persist?: boolean;
};
```

**Block-level keys are `$`-prefixed** — the same marker that already fences the `$filters` namespace and `$all`. One rule instead of a reserved-word list: *in a `filter` block, a `$` key is block config, everything else is a field*, so block options can never collide with an author's field name.

Client-side filtering over an already-loaded list — the direct replacement for `store/filteringExample.md` — is the same block with every field declaring `where`:

```ts
filter: {
  search:   { value: "", where: (v, q) => [v.name, v.model, v.brand_name, v.plateNumber]
                                            .some((s) => s?.toLowerCase().includes(q.toLowerCase())) },
  brand:    { value: null, where: (v, brand) => v.brand_id === brand },
  category: { value: [] as string[], where: (v, cats) => cats.some((c) => (v.category ?? []).includes(c)) },
}
```

Because every field is client-side here, `serverKey` is constant and filter changes issue **zero** requests — the "server returns everything and ignores params" deployment is *declared by construction*, not configured by a flag. Note what disappears from the consumer: every `if (!filter) return items` guard, every empty-array early return, and the `hasActiveFilters` helper — emptiness is decided once by the existing `isEmpty` and exposed as `filter.isActive`.

**Helpers are userland one-liners, not engine concepts.** They return ordinary configs, compose trivially, and the engine never knows they exist:

```ts
const debounced = (value, ms) => ({ value, debounce: ms });
const client = (value, where) => ({ value, where });

filter: { search: debounced("", 300), onlyNew: client(false, (i) => i.isNew) }
```

**Rules for `fields`.**
- Same config vocabulary as any leaf, normalized through the same `fieldMapping` pass as the rest of the config (`store/normalizeConfig.ts`) — filters are authored in external names like everything else. Shorthand expansion (`literal → { value: literal }`) runs *before* that pass.
- **Filter fields are flat leaves — no nested groups in Phase 1.** The shorthand makes this necessary: an object without a `value` key *is* an object-shaped literal default (a date range `{ from: "", to: "" }` is one value, not two fields). The one documented edge: a default that is itself an object **with** a `value` key must be wrapped explicitly — `{ value: { value: x, … } }`.
- A **derived** field (`value` is a function) is read-only: `recomputeLeaves` overwrites it on every recompute. Writing one is a dev-mode throw, not a silent no-op.
- **Dead config that looks live throws.** `param` or `debounce` on a `where` field is a dev throw: a `where` field never reaches the resolver, so a param rename or an invalidation debounce on it can never fire. (Same principle that made the earlier draft reject `where` next to an explicit server mode.)

### Classification — one syntactic rule, no mode

There is no `mode` key, no inference, and nothing to contradict: **`where` ⇒ client field, no `where` ⇒ server field.** Whether the list "is" client- or server-filtered is not declared anywhere — `FilterState` derives `hasClientFields` / `hasServerFields` from the block, and every consequence in this plan keys off one of those two booleans or off the individual field's class. A mixed block is not a special case; it is the general case.

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

`ctx.filter.values` is the full non-derived snapshot (server *and* client fields — a resolver may log or branch on it), `ctx.filter.params` is built **from server fields only** (per-field `param` renames, or `$toParams` over the values), and `ctx.filter.key` is the `serverKey`. `ctx` is passed **always** (never `undefined`), with `filter.values = {}` / `filter.params = undefined` on a list with no filter block, so a resolver never needs an existence check. Neither plan is implemented yet, so this costs one edit in `PaginationPlan.md` (§ Author-facing API, § Resolver contract, § `executePagedListResolve` step 1) and nothing in shipped code. **`values` (arg 1) keeps its meaning: form values with `$filters` stripped** — the filter is reachable only through `ctx`, so there is exactly one way to read it.

## Consumer-facing API

Gated on `listState.filter`; a list without a filter block keeps `LIST_SPREAD_KEYS` / `ENTITY_LIST_SPREAD_KEYS` byte-for-byte identical (the same both-branches rule pagination uses).

### The boundary: `filter` holds controls, the list holds data

No list row is ever reachable through `list.filter`, and no filter control through `list.*`. Three reasons, in ascending order of weight:

1. **The `filter.*` namespace belongs to the author.** Its keys are filter *field names* (`search`, `type`, `status`), so every builtin is a subtraction from the author's vocabulary. `values`/`set`/`reset`/`clear`/`isActive`/`activeCount`/`isPending` is already the whole budget; adding `items`/`length`/`map`/`getById` would roughly double the collision surface in the one place where names are user-chosen.
2. **One proxy would carry two subscription sources.** `filter.brand` subscribes the reading component to that field's leaf node; a `filter.items` would have to subscribe it to the `ListState`. Mixing them on one object is a trap in `react/createTrackingProxy.ts`, where the subscription is chosen by the read.
3. **Render code must not know where a field executes — decisive.** For server fields there is no projection at all: the server already returned the filtered rows, so a `filter.items` would be *identical* to `list.items`. A field that graduates from `where` to a server param — the exact one-line-of-config migration this plan expects when a list outgrows the client ceiling — would then break every component that rendered through `filter`. `list.map` / `list.length` mean "what this list is showing" for every field class, so the markup is written once.

### `list.filter` — a FilterProxy of controls

| Member | Meaning |
|---|---|
| `filter.<field>` | full field proxy (`value`, `label`, `isVisible`, `onValueChange`, …) — bindable to an input exactly like `form.name` |
| `filter.values` | plain snapshot of the **filter's own** values (derived fields included) — never list rows; this is the shape `$toParams` and the Phase 2 URL helpers consume |
| `filter.set(patch)` | bulk write; one notify, one invalidation |
| `filter.reset()` | back to declared defaults |
| `filter.clear(key?)` | clear one field (or all) to its **empty** value, not its default |
| `filter.isActive` | any non-derived field is non-empty (`store/compute/isEmpty.ts`) — replaces hand-written `hasActiveFilters` |
| `filter.activeCount` | how many such fields — the badge on a "Filters" button |
| `filter.isPending` | a debounced invalidation is queued but not yet issued |

`isActive` is **emptiness, and nothing else**: a set filter is a non-empty filter, whether it executes on the server or in a predicate. The alternative (active = differs from the declared default) reads well until `filter.clear()` — a field defaulting to `"car"`, cleared to `null`, differs from its default and would keep the badge lit right after the user pressed "Clear all".

The known consequence, accepted for Phase 1: a field with a **non-empty default** (`type: "car"`) is active from the first render, which is what `filteringExample.md` sidesteps by hand-skipping `type` in `hasActiveFilters`. No opt-out key is introduced for it. The rule stays one sentence long, and if a real UI needs the exception it can read `filter.values` itself; a per-field or per-filter escape hatch is a Phase 2 addition with a real use case behind it, not a Phase 1 guess.

### The list proxy — visible by default, full by explicit name

| Key | Returns |
|---|---|
| `list.values` | **visible** item proxies — the render entry point: `list.values.map(v => <input {...v.name} />)` |
| `list.items`, `list.map(fn)`, `[Symbol.iterator]` | the same visible set (`items` is the pre-existing spelling of `values`; `map` is `values.map`) |
| `list.length` | size of the visible set |
| `list.fullLength` | size of the full loaded membership |
| `list.getValues()` | **full** plain values — form data and submit payload |
| `list.getById`, `list.dirty`, `add` / `remove` / `setItems` | full membership |

The short names mean *what the list is showing*; the full membership is reachable only by asking for it in as many words. Whenever no client field is active — in particular on a list whose fields are all server-side — visible === full and every row above agrees; the divergence exists only under an active `where` predicate.

There is deliberately **no `matchCount` / `sourceCount`**: `length` and `fullLength` already are those two numbers, and a third spelling of a count is how UIs end up displaying the wrong one. `"{list.length} of {list.fullLength}"` is the "12 of 340" line.

The one consequence to document loudly: under an active client field `list.getValues().length !== list.length`, and `values.<list>.length` (form data, full) disagrees with `list.length` (view, visible). That is the split being made legible rather than hidden — a submit that silently dropped rows because a UI control was set is data loss, while a count that needs the word `full` in front of it is a lookup.

The whole surface in one component — and the same JSX works whatever mix of server and client fields the block declares:

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
export interface FilterFieldRuntime {
  node: object;                       // the leaf registered in nodeState/valuesCache
  isClient: boolean;                  // `where` declared
  where?: (item: unknown, value: unknown) => boolean;
  param?: string;                     // server fields only
  debounce?: number;                  // server fields only
}

export interface FilterState {
  /** field key → runtime info. */
  fields: Map<string, FilterFieldRuntime>;
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
  /** Client projection memo: valid while (key, listStateVersion) are unchanged. */
  memo: { key: string; version: number; ids: string[] } | null;
  /** Block-level config. */
  all?: (item: unknown, filterValues: Record<string, unknown>) => boolean;
  toParams?: (filterValues: Record<string, unknown>, context: Record<string, unknown>) => unknown;
  persist: boolean;
}
```

`ListState` gains one optional field: `filter?: FilterState`. Root `ListState` identity is never recreated (a load-bearing invariant per `PaginationPlan.md`'s ledger) — `FilterState` is mutated in place.

**Values slot.** `registerNodes` (`store/store/registerNodes.ts:153`, the `isListNode` branch) registers the (shorthand-expanded) filter fields as a group under path `$filters.<listPath>`, and `buildValuesCache` gets the matching branch creating `values.$filters.<listPath> = {}` before it stamps the list's own `[]`. Both walks already have the list branch to hang this on. Nested lists (`ownerEntity !== null`) do **not** allocate a `FilterState` in Phase 1 — a one-time dev warning, exactly as pagination does.

**Two hashes, two jobs.** `key` is `stableStringify` over *all* non-derived field values in sorted key order — it keys the client-projection memo (both per-field `where`s and `$all` read it). `serverKey` is the same hash over *server* fields only — it is the request identity: the queryKey ingredient, the `issuedKey` comparison, the thing a debounce gate checks. A client field is in `key` but not in `serverKey`; that asymmetry *is* the no-spurious-requests guarantee. Derived fields are excluded from both: they are pure functions of values already in the key, so including them is redundant and would make an author's `Date`-flavored derivation thrash the cache.

## Invalidation model (server fields)

The whole point of declared filters: **the dep set is known before run 1**. Pagination's bootstrap problem (auto-deps only exist after the first successful fetch, so the first queryKey is formed from an incomplete set and must later be re-keyed in place) does not exist for filter paths.

1. At registration, `FilterState.serverPaths` — server fields **only** — is unioned into `ResolveState.dependencies`, so the existing `findResolvesToRetrigger` (`store/resolvePipeline/findResolvesToRetrigger.ts`) and `retriggerByPaths` select this list on a server-field change with no new selection logic. A client-field change is not in the dep set at all: it never enters this pipeline, by construction rather than by suppression.
2. For paginated lists, `serverPaths` is *also* seeded into the bootstrap `QueryFamily.dependencies`, so `computeQueryKey` is correct on the very first fetch and the "re-key-in-place on widened deps" path is never entered for a filter field.
3. A server-field change therefore follows the path pagination already specifies for a queryKey change: **evict the foreign family, reset the pointer to `base`, exactly one fetch.** Resetting to page 1 on a filter change is mandatory, not a nicety — page 7 of the old result set is meaningless in the new one.
4. Non-paginated lists take the plain existing route: notify → `changedPaths` → `findResolvesToRetrigger` → `executeListResolve` re-run, with the auto-retrigger counter (`MAX_AUTO_RETRIGGERS`) still applying.

**Debounce is on invalidation only, and the delay belongs to the change, not to the request.** The gate sits in the post-notify hook (`store/init/createResolveManager.ts:494`), *before* `findResolvesToRetrigger`:

- The field value updates **synchronously** on every keystroke — the input never lags, computed props and the client projection see it immediately. What is delayed is the *issue*: the timer is armed with the changed field's `debounce`, `filter.isPending` reads true, and on the trailing edge the gate re-reads the **current** `serverKey` (never a value captured at arm time — a captured value is a stale request waiting to happen) and issues iff `serverKey !== issuedKey`.
- **An undebounced server-field change flushes immediately and carries everything.** The request is one per list and carries the whole params object, so if `search` (300 ms) is in flight on the timer and the user picks `brand` (no debounce), the request goes out *now* with the current `search` included; the pending timer then fires into `serverKey === issuedKey` and does nothing. Mixed debounces need no arbitration — the serverKey comparison is the arbitration.
- **The first resolve is never debounced** — the delay is a property of a change, not of initialization; a list whose filter has a non-empty default must not start with an artificial pause.
- `filter.set()`, `reset()` and `clear()` flush any pending timer before their own (single) invalidation.

Without the gate, a 300 ms-typed query fires one request per character and the last-arriving response is not necessarily the last-typed one.

**When a change does not issue a request** — four cases, three of them free:

1. The value returned to what was last issued (typed "a", deleted it): `serverKey === issuedKey`, the gate declines. A hash comparison, no machinery.
2. Only client fields changed: they are not in `serverKey`, so the request identity did not change — nothing was suppressed, nothing arose.
3. The new `serverKey` is already loaded: that is the **cache's** decision, not the filter's. Under pagination, `QueryFamily` keyed by queryKey answers it; the filter's whole obligation is a correct, stable key.
4. The server ignores filter params entirely: declare every field with `where` — `serverKey` is then constant and case 4 *is* case 2.

**Race safety** rides on the mechanisms already designed: the executor captures `issuedKey` in its closure and drops a completion whose key no longer matches the live one, the same way it drops a stale `generation` or ordinal.

**Predicates are never part of any key.** `where`, `$all` and `$toParams` are static config; only *values* form keys. A predicate closing over external mutable state is undetectable and unsupported — documented, not guarded.

## Client fields: filtering is a projection, never a mutation

`itemIds` stays the **full** resolved membership. The client fields produce `visibleIds` at read time, memoized on `(filter.key, ListState version)`. This mirrors pagination's mutation-inversion decision — one authoritative store, everything visible derived from it — and it is what keeps membership `dirty` honest: filtering must not make a list dirty.

Per-field `where` predicates are skipped while their field's value `isEmpty`; the survivors are ANDed; `$all` runs last and always. The split, stated once, exhaustively:

| Reads the **visible** projection | Reads the **full** membership |
|---|---|
| `values`, `items`, `map`, `[Symbol.iterator]`, `length` | `getValues()`, `fullLength`, `dirty`, `getById`, `values.<list>` / `valuesCache`, submit payload, persist, `add`/`remove`/`setItems` |

Rationale for the two non-obvious rows: **`getById` is identity lookup, not a view concern** — an edit dialog opened from a row must not break because the row was just filtered out from under it. And **`getValues()` is the form's value, which is the whole list** — a filtered payload would silently drop rows the user never chose to remove, which is data loss caused by a UI control. `getValues()` is therefore the one read whose name is short but whose meaning is "full"; it earns the exception by being the submit path, and the plain-values snapshot of what is on screen is `list.values.map(v => v.getValues())`.

**Locally added ids bypass the predicates.** An id present in `itemIds` but not in `initialItemIds` is always visible. Without this, `list.add({...})` under an active filter makes the new row vanish at the instant it is created — the single most confusing thing this feature could do. The exemption is exactly the local-delta-vs-server-truth split pagination already uses for accounting, and it ends at the next resolve, which rewrites `initialItemIds`.

**A `where` field on a paginated list is a dev throw in Phase 1** — and the throw names the field (`filter field "onlyNew" declares where on paginated list "vehicles"`). Pages are server-truth windows; predicating them client-side yields short pages, a `total` that lies, and a `hasNextPage` that cannot be derived from anything. The legitimate combination is server fields. (Phase 2 revisits *filter-the-loaded-window* semantics for infinite mode, where it is at least definable.)

## Cross-cutting behavior

- **`getValues()` strips `$filters`** (`store/store/palistor.ts:367`) — one delete on the structuredClone. Consequently the resolver's `values` proxy does not see filters either, which is intended: `ctx.filter` is the one way in.
- **`store.reset()`** does not touch filters: `resetPipeline` walks `rootConfig`, and `walkFull` hands lists to `onList` without descending (`store/traversal/walkFull.ts:49`), so filter nodes are outside its reach by construction. `filter.reset()` is the explicit, separate verb. This is a decision, not an accident — resetting a form should not wipe the user's search.
- **Persist** is opt-in per list (`$persist: true`) and writes under a reserved `__filters` blob keyed by list path, alongside `__flows`. Hydration writes values, recomputes `key`/`serverKey`, and — critically — sets `issuedKey = serverKey` **only** when the list's own resolve state is also being restored under the same key; otherwise a restored filter would be displayed while the list shows unfiltered server rows. Restored filters are stripped if the config's field set no longer matches (version/fingerprint discard, same rule as the pagination blob).
- **submit** is unaffected: `submitPipeline` walks the config tree, which never enters the list's `filter` block.
- **`react/createTrackingProxy.ts`**: reading any `filter.*` field subscribes to that field's leaf node; reading `filter.isActive`/`activeCount`/`isPending` subscribes to the `ListState`. On the list side, the **visible** reads (`values`, `items`, `length`, `map`) must subscribe to the **client** filter fields as well as to the `ListState` — their result is a function of both, so a component that renders `list.values` re-renders on a keystroke in a `where` field without ever reading the filter. (Server fields reach the visible set through the resolve → `ListState` change, which is already subscribed.) `fullLength`, `getValues()` and `getById` subscribe to the `ListState` only. Methods stay untracked, matching the existing list-proxy convention.
- **Per-entity lists**: no `FilterState` in Phase 1 (dev warning), Phase 3 for parity — the same staging pagination uses, for the same reason (`triggerEntityListResolve` needs its dedup reworked first).

## Non-goals (with reserved seams)

**Sorting is not in this plan**, but it is the same family — list-owned state that must reach the resolver and must invalidate — so `ctx.sort` is reserved in the resolver contract from day one and `SORT_SPREAD_KEYS` is reserved against `fieldMapping` at the same time as the filter keys. Adding a `sort` block later is then additive, not breaking. Likewise reserved: `ctx.signal` (resolver cancellation), and filter **option sources** (a filter field whose choices are themselves resolved from the server — a `resolve` block on a filter field, which the existing per-field entity resolver machinery is already shaped for).

**A field that is both server param and client predicate** (`param` + `where` — optimistic local narrowing while the refetch flies) is expressible in the config shape but deliberately not built: it would turn the one-sentence classification rule into three sentences for a scenario nobody has presented. The combination throws today (dead-config rule); if a real case shows up, lifting the throw is additive.

## Files to change

| File | Change |
|---|---|
| `store/store/types.ts` | Add `FilterFieldConfig`, `FilterBlock`; `filter?: FilterBlock` on `ListConfig`; `filter?: FilterState` on `ListState`; widen `resolver` to `(values, store, ctx: ListResolveContext)`; add `filter` / `values` / `fullLength` to `ListProxyNode<T>` (optional); `values` is typed as the item-proxy array, i.e. the same type as `items`. |
| `store/filtering/types.ts` | **New:** `FilterState`, `FilterFieldRuntime`. |
| `store/filtering/normalizeFilterBlock.ts` | **New:** split `$` keys from fields; expand literal shorthand (`"value" in node` discriminator); classify each field (`where` ⇒ client); dev throws: `param`/`debounce` on a client field, `where` field on a paginated list, nested list config as a field. |
| `store/filtering/filterController.ts` | **New:** `computeFilterKey` / `computeServerKey` (stable hashes, derived fields excluded; serverKey over server fields only), `buildFilterParams` (per-field `param` renames or `$toParams`), `applyClientFilter` (per-field predicates skipped on `isEmpty`, `$all` last, local-add exemption, memoized on `(key, version)`), `resetFilter`, `clearFilter`, `isFilterActive`/`activeCount` (non-empty, derived fields skipped), `scheduleFilterInvalidation` (per-field debounce, trailing-edge current-value read, immediate flush for undebounced fields, first-resolve bypass, `set`/`reset`/`clear` flush). |
| `store/filtering/registerFilterNodes.ts` | **New:** register the expanded fields as a flat group at `$filters.<listPath>`; reject writes to derived fields (dev throw). |
| `store/defineList.ts` | Accept `filter?: FilterBlock` and thread it into `listConfig.filter`; node shape `[template, listConfig]` unchanged. |
| `store/store/registerNodes.ts` | List branch (`:153`): allocate `FilterState` for root lists, call `registerFilterNodes`, record `paths`/`serverPaths`. |
| `store/valuesCache/valuesCache.ts` | List branch: create the `values.$filters.<listPath>` object before stamping the list's `[]`. |
| `store/normalizeConfig.ts` | Normalize the (shorthand-expanded) filter fields through the same external→internal pass as the rest of the config. |
| `store/buildProxy/buildListProxy.ts` | `if (listState.filter)`-gated: `filter` GET returning the FilterProxy; new `values` GET (visible item proxies) and `fullLength` GET; `items`/`length`/`map`/iterator (`:298`, `:304`, `:342`, `:368`) route through `applyClientFilter` when `hasClientFields`; `getValues` (`:346`), `getById` (`:336`), `dirty` (`:326`), `add`/`remove`/`setItems` keep reading full membership; union `FILTER_SPREAD_KEYS` into **both** spread-key branches with matching `ownKeys`/`getOwnPropertyDescriptor`. |
| `store/buildProxy/buildFilterProxy.ts` | **New:** field proxies (reuse the leaf-proxy path) + `values`/`set`/`reset`/`clear`/`isActive`/`activeCount`/`isPending`. |
| `store/resolvePipeline/types.ts` | **New export:** `ListResolveContext` (`filter`, `page`, `sort`, `queryKey`, `signal`). |
| `store/resolvePipeline/executeListResolve.ts` | Build and pass `ctx`; capture `issuedKey` in the closure and drop a completion whose key no longer matches (alongside the existing `status !== "pending"` abort); union `FilterState.serverPaths` into `state.dependencies` on both success and error paths. |
| `store/init/createResolveManager.ts` | Seed `FilterState.serverPaths` into `ResolveState.dependencies` at init (so run 1 and `findResolvesToRetrigger` are correct); route filter-field changes to the owning list directly instead of by path match; the debounce gate in the post-notify hook (`:494`), ahead of `findResolvesToRetrigger`. |
| `store/store/palistor.ts` | Constructor: reserve `FILTER_SPREAD_KEYS` (+ `SORT_SPREAD_KEYS`) against `fieldMapping` collisions (throw). `getValues()`: strip `$filters`. |
| `store/constants.ts` | Add `FILTER_SPREAD_KEYS`, reserve `SORT_SPREAD_KEYS`; add `values` and `fullLength` to `LIST_SPREAD_KEYS` (`:198`); extend `LIST_ONLY_KEYS` (`:228`) with `filter`, `values`, `fullLength` — all three must be matched raw, before `externalToInternal` translation (`value` is a mappable key, so `values` is genuinely exposed to the same trap `error`/`reload` hit). |
| `store/persist/persistManager.ts` | `__filters` blob (opt-in via `$persist`, per list, fingerprint-or-discard); hydration sets `issuedKey` only under a matching restored resolve state. |
| `react/createTrackingProxy.ts` | Subscribe on filter field reads and on the filter aggregates; subscribe the visible list reads (`values`/`items`/`length`/`map`) to the client filter fields too. |
| `PaginationPlan.md` | Amend the resolver signature to the shared `ctx` object; note that server filter paths seed `QueryFamily.dependencies` and so skip the bootstrap re-key. |

## Phasing

**Phase 1 — the filter as list state, per-field classification, root lists.**
`FilterBlock`/`FilterState`; literal shorthand + `$`-key split (`normalizeFilterBlock`); `$filters` values slot + `registerFilterNodes`; the `filter` proxy with fields, `set`/`reset`/`clear`, `isActive`/`activeCount`/`isPending`; the list-proxy split `values`/`items`/`map`/`length` (visible) vs `fullLength`/`getValues()`/`getById`/`dirty` (full); derived fields via the existing compute pipeline; `ctx` resolver contract; server fields (`param` renames, `$toParams`, `serverPaths` dep seeding, one-fetch invalidation, page reset under pagination, per-field debounce with the flush rules, `issuedKey` completion gate); client fields (per-field `where` with `isEmpty` skipping, `$all`, memoized projection, local-add exemption, the visible/full split table); `getValues()` strip; `fieldMapping` reservation; dead-config throws (`param`/`debounce` on `where` fields, `where` on paginated lists); nested-list dev warning. **Outcome:** `store/filteringExample.md` deletes entirely; a server-field change causes exactly one resolver run; a client-field change causes zero; membership `dirty` and the submit payload are unaffected by filtering.

**Phase 2 — lifecycle and ergonomics.**
`$persist` (`__filters` blob with the fingerprint rule); URL sync helpers (`filter.toQuery()` / `filter.fromQuery()`) — the single most-repeated piece of app code around any filter UI, deliberately held back from Phase 1 because it needs its own pass on array serialization, router-agnosticism and the interaction with persist, and because `filter.values` + `filter.set()` already let an app bridge it by hand; filter presets (`filter.apply(named)`); `keepPreviousData` interaction (show the old rows greyed while the new filter loads, instead of a flash of empty); filter-the-loaded-window semantics for infinite pagination, if it survives its own design pass; lifting the `param`+`where` throw into optimistic local narrowing, if a real case appears.

**Phase 3 — completeness.**
The `sort` block on its reserved seam; per-entity (nested) list filters, after `triggerEntityListResolve` is routed through the shared executor; filter fields with their own `resolve` (server-driven option lists); resolver cancellation via `ctx.signal`; nested field groups inside `filter`, if a real config needs them (requires an explicit group marker, since a plain object is a literal default).

## Decision ledger

- **`filter` is top-level in `defineList`, not inside `resolve`** — a resolver-less list is still filterable, and an all-`where` block is precisely that case.
- **Filter fields are real leaf nodes with a `valuesCache` slot**, not an opaque POJO. This is what buys derived values, computed labels, validation, notification and tracking with zero new pipeline code; the cost is one reserved values namespace.
- **Reserved namespace `$filters.<listPath>`, stripped from `getValues()`/submit, untouched by `store.reset()`** — filters are view state. Any placement inside the list's own `values` slot was rejected: that slot is an array, so extra properties do not survive `structuredClone`/`JSON.stringify` and would silently vanish from persist.
- **Literal shorthand: `filter: { search: "" }`** — a non-config default expands to `{ value: literal }`, discriminated by the same `"value" in node` rule the whole codebase stands on (`store/traversal/nodeClassifier.ts:22`). The 90% case is a plain object, Relay-style; the full leaf vocabulary is opt-in per field.
- **Filter fields are flat leaves; an object default without a `value` key is an object-shaped literal** — the shorthand makes nested groups ambiguous, so they are out of Phase 1. A default that itself contains a `value` key is wrapped explicitly (`{ value: {…} }`) — one documented line.
- **No `mode`, no inference, no enum: `where` ⇒ client field, otherwise server field** — one syntactic per-field rule replaces three block-level mechanisms (declared mode + inference + contradiction throw). A mixed block is the general case, not a special one. `hasClientFields`/`hasServerFields` are derived, never declared.
- **A `where` field is excluded from `serverKey`, params, and resolver deps** — client-field changes issue no request *by construction*, and the "server ignores filter params" deployment is the all-`where` block (constant `serverKey`, zero requests) rather than a flag.
- **Two hashes: `key` (all values — client memo) and `serverKey` (server values — request identity)** — the asymmetry between them is the no-spurious-requests guarantee. "Don't refetch what's loaded" is the cache's job (`QueryFamily`), not the filter's; the filter owes only a correct stable key.
- **Block-level config rides `$`-prefixed keys (`$all`, `$toParams`, `$persist`)** — one marker, already fencing `$filters`, instead of a reserved-word list subtracting from the author's field vocabulary.
- **Per-field `param` for the 1:1-rename case; `$toParams` as the whole-shape escape hatch** — and `param` or `debounce` on a `where` field throws: dead config that looks live is worse than a missing feature. `param` + `where` (optimistic narrowing) stays expressible-but-thrown until a real case lifts it.
- **One `ctx` object as the resolver's third argument**, shared with pagination — two plans cannot each own arg 3. Costs one edit in `PaginationPlan.md`, nothing in shipped code.
- **Declared server-field paths seed the dep set before run 1** — filters have no bootstrap gap, and under pagination they make the very first `queryKey` correct, bypassing the re-key-in-place dance.
- **A server-field change resets pagination to `base`** — page 7 of the previous result set has no meaning in the new one.
- **Debounce is per-field, delays invalidation, never the value; the trailing edge reads current values** — the input stays synchronous, an undebounced change flushes immediately carrying the debounced fields' current values (the `serverKey === issuedKey` check *is* the arbitration between mixed debounces), the first resolve is never debounced, and `set`/`reset`/`clear` flush. `isPending` exposes the gap.
- **Client filtering is a read-time projection; `itemIds` is never rewritten** — otherwise every filter interaction flips membership `dirty` and corrupts the reset baseline. Same inversion pagination adopted.
- **`list.filter` carries controls only; rows are read from the list** — the filter's key space belongs to the author, one proxy must not mix two subscription sources, and above all render code must not know where a field executes: for server fields a `filter.items` would be indistinguishable from `list.items`, so the `where`→server migration would break every component that used it.
- **Short names are the visible set, the full membership is spelled out: `length` / `fullLength`** — `length` must agree with what `map` renders, so making them diverge would give one read two meanings. No `matchCount`/`sourceCount`: a third spelling of a count is how a UI displays the wrong one.
- **`list.values` is the visible item proxies** (an alias of `items`, and what `map` iterates), so a filtered list is rendered — and edited — through one entry point.
- **`getValues()` and the submit payload read full membership; `getById` too** — form data and identity lookups must not be view-dependent, or a filter control silently deletes rows on submit. The resulting `getValues().length !== length` is documented, not smoothed over.
- **`isActive` is emptiness, not difference-from-default, with no opt-out key** — otherwise `clear()` on a field with a non-empty default leaves the badge lit immediately after "Clear all". A field with a non-empty default therefore reads as active from the start; that is accepted rather than papered over with a config flag nobody has asked for yet.
- **Both `reset()` (to defaults) and `clear()` (to empty) exist** — they differ only for a field with a non-empty default, which is exactly the case every consumer otherwise hand-writes.
- **The client-projection memo ships keyed on `(key, list version)`** — a whole-list re-predicate on any membership change or entity edit. The ceiling (order of a few thousand rows) is documented; past it the answer is server fields, which is the same population that needs server paging anyway. Per-field partial invalidation is a Phase 2 option, not a Phase 1 cost.
- **Locally added ids bypass the client predicates until the next resolve** — an optimistic add must not vanish on creation.
- **A `where` field on a paginated list throws in Phase 1, naming the field** — short pages, a lying `total`, an underivable `hasNextPage`.
- **Only values form keys; predicates never do** — `where`/`$all`/`$toParams` are static config; functions are neither serializable nor comparable.
- **Derived filter fields are read-only and excluded from both keys** — `recomputeLeaves` owns their value, and they are a pure function of values already keyed.
- **`where` takes `(item, value)`** — consistent with `$all(item, filterValues)`: the item first in every predicate.
- **`filter` goes in `LIST_ONLY_KEYS`** — a `fieldMapping` renaming something to `filter` would otherwise rewrite `list.filter` into a miss returning `undefined`, the exact trap documented for `error` at `store/constants.ts:228`.

## Rejected shapes

Four API shapes were worked through and rejected before landing on per-field `where`; recorded so they are not re-litigated.

1. **Block-level `mode: "server" | "client"` + a separate `where: {}` map** (this plan's first draft). Three mechanisms for one fact — a declared mode, an inference rule, and a contradiction throw — plus a parallel map whose keys must match `fields` by string: a typo is a silently dead predicate, a rename is a broken pair.
2. **A value/predicate union in the value slot: `weight: 0 | ((w, i) => boolean)`.** The function position already means *derived value* (`recomputeLeaves.ts:33`), arity and return type are not statically distinguishable, the predicate loses its default value (nothing to bind the input to, nothing for `isEmpty`/`reset`), and the union collapses TS inference.
3. **One function returning both: `price: (p, item) => ({ price, filter: item.price > p })`.** The engine would have to call it in a context where `item` does not exist (params are needed *before* the rows are loaded), `filter` becomes a magic key inside the params namespace, and the value slot gains a third overload. The engine must also know a field's class *before* run 1 (dep seeding, subscriptions, the pagination throw) — a classification announced only by a return value cannot be known statically.
4. **Two blocks: `serverFilters: {}` + `clientFilters: {}`.** A bare predicate has no state slot, so either the blocks are zipped by key (the parallel-map problem again, worse) or each entry grows a `{ value, where }` shape — reproducing the per-field design twice. And the UI surface forks: components must bind `list.serverFilters.brand` vs `list.clientFilters.brand`, so the client→server migration renames a path in every component, while the aggregates (`isActive`, `clear`, …) either double or need a third merging entity.

Also rejected: a third `list` argument in `where` predicates (`(v, i, list) => …`) — the predicate stops being a function of the item (O(n²), breaks the memo); cross-item rules are `$all`'s job, and "options derived from the data" is the Phase 3 option-source seam, not a filter predicate.

## Settled questions

Every question this plan opened is answered; they are kept here in one place because the answers are what the ledger above encodes.

1. **Two verbs, `reset()` and `clear()`** — kept. They differ only for a field with a non-empty default, which is exactly the case every consumer otherwise hand-writes.
2. **`isActive` = non-empty**, not differs-from-default, and no per-field opt-out. A set filter is a non-empty filter; a field with a non-empty default reads as active from the first render, and that is accepted for Phase 1 rather than answered with a config flag no real UI has asked for yet.
3. **Classification is per-field and syntactic** — `where` ⇒ client, otherwise server; no `mode` key exists. (Supersedes the first draft's block-level mode + inference.)
4. **`length` is the visible set, `fullLength` the loaded one**, and `list.values` is the visible item proxies. `getValues()`/`getById`/`dirty`/submit stay full.
5. **The client-projection memo ships as specified** with its ceiling documented; past it the answer is server fields.
6. **The config's 90% form is a plain object** — literal shorthand through the `"value" in node` discriminator; helpers (`debounced`, `client`) are userland one-liners the engine never sees.

One asymmetry is deliberate and stays: **`list.values` is item proxies while `filter.values` is a plain snapshot.** The two are used for different things — a list is rendered and edited through its proxies, a filter is never rendered as data, and its individual proxies already have an address (`filter.<field>`), so a proxy array there would have no consumer. The doc-comment on each states what it returns.

## Test plan

- **Shorthand & classification:** `filter: { search: "" }` registers a leaf with default `""`; an array default is a literal; an object default without `value` is an object-shaped literal; an object with `value` is a config; `$all`/`$toParams`/`$persist` are split out as block config and never become fields; `where` present ⇒ client field, absent ⇒ server field; `param`/`debounce` on a `where` field throws; `where` on a paginated list throws naming the field.
- **State layer:** filter fields register at `$filters.<listPath>`; derived fields recompute on dependency change; a write to a derived field throws in dev; `fieldMapping` normalizes filter field configs (after shorthand expansion); a `fieldMapping` colliding with a filter key throws at construction.
- **Boundaries:** `getValues()` contains no `$filters`; `store.reset()` leaves filter values untouched; `submit()` payload excludes filters and includes the **full** membership under an active client field; `list.filter` exposes no list data (`filter.items`/`filter.length`/`filter.map` are `undefined`, and a filter field *named* `items` resolves to that field); persist writes `__filters` only under `$persist: true` and discards a blob whose field fingerprint changed.
- **Server fields:** a server-field change triggers exactly one resolver run and the resolver receives `ctx.filter.params` (per-field `param` renames applied; `$toParams` overrides the shape); N rapid changes under `debounce: 300` produce one run; the trailing edge issues with the **current** value, not the value at arm time; an undebounced field change while a debounced timer is pending issues immediately with the debounced field's current value and the timer then no-ops (no double fetch); the first resolve is not delayed by any `debounce`; `isPending` is true across the gap; a completion whose `issuedKey` is stale is dropped; typing a value and reverting it before the trailing edge issues nothing (`serverKey === issuedKey`); the auto-retrigger cap still applies.
- **Client fields:** a client-field change triggers **zero** resolver runs (not in deps, not in `serverKey`); on an all-`where` block no filter change ever issues a request; predicates skip empty fields; `$all` runs last; `values`/`items`/`length`/`map`/iterator are filtered while `dirty` stays false across every filter permutation; `getValues()`, `fullLength`, `values.<list>` and `getById` stay full (a filtered-out row is still found by id and still in the payload); `list.values` items are writable proxies whose edits notify normally; `length === fullLength` whenever no client field is active; a row added under an active non-matching filter stays visible until the next resolve, then disappears; the memo is not recomputed when nothing relevant changed, and *is* recomputed after `add`/`remove`/entity edit.
- **Mixed blocks:** with `search` (server) and `onlyNew` (`where`) on one list — `search` changes refetch and `onlyNew` does not appear in `ctx.filter.params`; `onlyNew` changes re-project without a fetch; `isActive`/`activeCount` count non-empty non-derived fields of both classes; `clear()` always ends with `isActive === false`, while `reset()` ends active iff some declared default is non-empty — the one observable difference between the two verbs.
- **Pagination interplay** (once Phase 1 of `PaginationPlan.md` exists): a server-field change evicts the family, resets to `base`, and issues exactly one fetch; the bootstrap `queryKey` already includes server filter values on run 1.
- **Non-regression:** a list with no `filter` block has an identical `ownKeys`/spread/GET set, and `executeListResolve` behaves byte-for-byte as today apart from receiving a `ctx` whose `filter.values` is `{}`.
- **Port `store/filteringExample.md`** to the new API (an all-`where` block) as an integration test and assert identical output to the original pure functions over the same fixture — the acceptance criterion for deleting that file.
