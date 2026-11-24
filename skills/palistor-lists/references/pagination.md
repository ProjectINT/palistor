# Paginating a list

`resolve.pagination` turns a list into a page cache. The resolver is called once per page; every loaded page is kept, and showing a cached page is synchronous. The block is the only switch: without it the list behaves as a plain list.

## Resolver contract

```ts
import { defineList } from "palistor";

interface Order { id: string; title: string }
declare function fetchOrders(query: {
  search: string; tenant: unknown; offset: number; limit: number; cursor?: string | null;
}): Promise<{ rows: Order[]; count: number; next: string | null }>;

export const orders = defineList<Order>({
  template: { id: { value: "" }, title: { value: "" } },
  resolve: {
    pagination: { pageSize: 20, mode: "paged" },
    resolver: async (values, store, ctx) => {
      const page = ctx.page!; // typed optional; always present on a paginated list
      const r = await fetchOrders({
        search: values.search, // every value and context key read here is part of the query key
        tenant: store.context.tenantId,
        offset: page.offset, // (page - base) * pageSize
        limit: page.pageSize,
        cursor: page.cursor, // cursor and infinite modes
      });
      return { items: r.rows, total: r.count, nextCursor: r.next };
    },
  },
});
```

- `ctx.page` is `{ page, pageSize, offset, cursor?, queryKey }`.
- `ctx.sort` is `{ by: [{ key, param, dir }], key }`, empty (`by: []`) while nothing is sorted. With a `sort` block a paginated list is sorted by its server: send `ctx.sort.by` with the request, see [sorting](sorting.md), "Server-side sorting".
- Return `{ items, total?, nextCursor?, hasMore? }`. `total` drives `pageCount`, `total` and `hasNextPage`. Without it return `hasMore`, or a bare array: the list then assumes there is a next page while pages come back full.
- In `cursor` and `infinite` modes an explicit `nextCursor: null` means "this was the last page": `hasNextPage` is `false`, `loadMore()` and `nextPage()` request nothing, and in `cursor` mode neither do `setPage(next)` and `prefetch(next)`. The `null` wins over `total`, over `hasMore: true` and over a full page. A page without the field (`undefined`) says nothing and the rule above decides. So a feed that continues by `offset` must leave `nextCursor` out, not send `null`. Source: `cube/core/pagination.test.ts` ("nextCursor: null ends the feed (cursor and infinite)"), `cube/core/pagination.ts` (`pastEnd`, `hasNextPage`).
- Take the offset, page size and cursor from `ctx.page` only. Do not keep a page number of your own.

## Modes

| `mode` | On screen | Navigation | Continuation |
| --- | --- | --- | --- |
| `"paged"` (default) | One page | `setPage(n)`, `nextPage()`, `prevPage()` to any page | `offset` |
| `"infinite"` | All loaded pages, appended | `loadMore()` | `nextCursor` when the resolver returns one, else `offset` |
| `"cursor"` | One page | `nextPage()`, `prevPage()` (always cached) | `nextCursor` |

```tsx
import { defineList, Palistor, useForm } from "palistor";
import type { PalistorRef } from "palistor";

interface Post { id: string; text: string }
declare function fetchFeed(cursor: string | null | undefined, limit: number): Promise<{ posts: Post[]; next: string | null }>;

const feed = defineList<Post>({
  template: { id: { value: "" }, text: { value: "" } },
  resolve: {
    pagination: { pageSize: 30, mode: "infinite" },
    resolver: async (values, store, ctx) => {
      const r = await fetchFeed(ctx.page!.cursor, ctx.page!.pageSize);
      return { items: r.posts, nextCursor: r.next }; // `next: null` from the API ends the feed
    },
  },
});
export const store = new Palistor({ config: { feed } });

export function Feed() {
  const list = useForm(store).feed;
  if (list.isInitialLoading) return <p>Loading…</p>;
  return (
    <>
      <ul>{list.map((post, index, id) => <PostRow key={id} post={post} />)}</ul>
      {list.continuationLost && <button onClick={() => list.refetch?.()}>Reload feed</button>}
      {list.hasNextPage && (
        <button disabled={list.isFetchingNextPage} onClick={list.loadMore}>
          {list.isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      )}
    </>
  );
}

function PostRow({ post }: { post: PalistorRef<Post> }) {
  return <li>{useForm(post).text.value}</li>;
}
```

## Members

All of them are typed optional, because they exist only on a paginated list. Pass a method as a handler (`onClick={list.nextPage}`) or call it with `?.()`; read a value with a fallback (`list.page ?? 1`).

| Member | Meaning |
| --- | --- |
| `page`, `pageSize` | Current page (numbered from `base`, default 1) and page size. |
| `pageCount` | From the server total; without one, the number of contiguous cached pages. |
| `total` | Display total: the server total plus local adds and removes. `undefined` until known. |
| `serverTotal` | The server total. Moves only on a fetch, `store.delete` or a confirmed add. |
| `hasNextPage`, `hasPrevPage` | Not affected by local adds. `hasNextPage` is `false` after a page that came with `nextCursor: null` (`cursor` / `infinite`). |
| `isFetching` | Some page of the current query is being fetched. `list.loading` is the same signal plus the first fetch that is about to start. |
| `isInitialLoading` | Nothing to show and a fetch is running or about to start: choose a skeleton over a spinner. `true` from the first read; reading it starts the lazy first fetch, as reading the rows or `loading` does (`isFetching` does not). |
| `isPreviousData` | With `keepPreviousData`: the rows on screen belong to the previous query, while `page`, `pageCount`, `total` and `hasNextPage` already describe the new one (Query key). |
| `setPage(n)`, `nextPage()`, `prevPage()` | Cached and fresh: synchronous. Otherwise one fetch; the previous rows stay until it lands. |
| `prefetch(n)` | Fetch a page into the cache without showing it. |
| `setPageSize(n)` | Clear the cache and fetch the first page once. |
| `refetch()` | Exactly one request. `paged`: all pages go stale, the current one is fetched now. `infinite` / `cursor`: back to the first page. `list.reload()` does the same. |
| `invalidate(page?)` | Mark one page or all pages stale; the current page is fetched now. In `cursor` / `infinite` every later page is dropped. |
| `pendingAdds`, `discardPendingAdds()` | Ids of local rows the server has not confirmed; drop them. |
| `loadMore()`, `isFetchingNextPage`, `loadedPages` | `infinite` only. `loadedPages` is `[{ ordinal, ids }]` for section headers. |
| `continuationLost` | `infinite` / `cursor`: the cursor chain could not be rebuilt; offer a reload. |
| `isStaleFromStorage`, `scrollAnchor`, `setScrollAnchor(id)` | Persisted lists, see Persist below. |

## Query key

The query is identified by what the resolver read: form values, `store.context` keys, the list's server filter fields (their applied values, for a manual filter) and its sort.

- When one of them changes (`filter.apply()` and a sort change included), the cached pages belong to another query: the list returns to the first page and fetches it once. The rows are cleared at once (`isInitialLoading` is `true`) unless `keepPreviousData: true`.
- With `keepPreviousData` the previous query's rows stay on screen (`isPreviousData: true`), but the pager already describes the new query, which has no answer yet: `page` is the first page, `pageCount` is `0`, `total` is `undefined`, `hasNextPage` and `hasPrevPage` are `false`. Source: `cube/core/pagination.ts` (`ensureFamily`, `pageCount`, `total`); authoring probe.
- Writing the same value back is a no-op.
- `maxCachedQueries` above 1 keeps earlier queries, so switching back to a previous filter is served from the cache.
- `resolve.deps` seeds the key before the first run; it is rarely needed.
- `pagination.queryKey(values, context)` replaces the automatic key when the values read are not serializable.

## Local edits

- `list.add`, `remove` and `setItems` change the cached page they land on: the current page (`infinite`: the last loaded one). `setItems` is not supported in `infinite` mode and throws in development.
- `list.dirty` covers every cached page of the current query, so an unsaved add on an off-screen page keeps the list dirty. The nested lists of those rows count too: an edit inside one keeps the list dirty while its owner row is off screen, and `store.reset()` clears it without a request. Source: `cube/core/listDirty.test.tsx` ("a nested edit on a cached page that is off screen keeps the list dirty; reset clears it").
- `store.rekey(tempId, realId)` confirms an added row: it becomes server truth, `serverTotal` grows by one and the row no longer counts as a pending add.
- `store.delete(id)` takes the row out of every cached page and marks the later pages stale.
- `store.reset()` rolls back local adds and removes on every cached page. It keeps the current page and sends no request.
- An id that already sits on another cached page is not added twice.

## Options

| `pagination` option | Default | Meaning |
| --- | --- | --- |
| `pageSize` | required | Rows per page. |
| `mode` | `"paged"` | `"paged"`, `"infinite"` or `"cursor"`. |
| `base`, `initialPage` | `1`, `base` | Page numbering (`base` is 0 or 1) and the first page shown. |
| `staleTime` | `Infinity` | Milliseconds a cached page is shown without a background refetch. |
| `maxCachedQueries`, `gcTime` | `1`, `Infinity` | How many queries are kept, and for how long once inactive. |
| `maxCachedPages` | `Infinity` | Cap on cached pages per query. Pages on screen are never evicted. |
| `maxPages` | `Infinity` | `infinite`: how many pages stay on screen; older ones leave memory. |
| `keepPreviousData` | `false` | Keep the previous query's rows while the first page of the new one loads. |
| `persist` | `{ maxPages: 3 }` | What `usePersist` stores: a bounded tail, `"window"` (everything, plus the scroll anchor) or `false`. |
| `persistPendingAdds` | `"keep"` | Whether unconfirmed local rows survive a reload (`"drop"` discards them). |
| `revalidateOnHydrate` | `"first"` | What a restored list refetches after paint: `"none"`, `"first"` or `"all"`. |
| `queryKey` | automatic | See Query key. |

A wrong `pageSize`, `base`, `mode` or `persist.maxPages` throws when the store is created.

## Persist, Suspense, nested lists

- A saved window is restored without a request when two conditions hold: the saved query matches the live values, context and sort (the sort itself is never saved, so a window saved under another sort is not restored for a store that starts at `$default`), and the hydration lands before the list's first fetch starts. The second holds when `await store.persist.enable(…)` has resolved before anything reads the list (or before `store.start()`). `usePersist` hydrates in an effect, after the read in the render and after `usePalistor` has started the store, so with it the first page is requested once and the restored window then replaces it. Source: `cube/contract/sliceG/pagination.test.ts` (E1: `await persist.enable` first, then the read: zero requests), `cube/core/persist.ts` (`hydrate` awaits the driver), `cube/react/usePersist.ts`, `cube/core/sortServer.test.ts` ("a persisted window"); authoring probe (`usePalistor` + `usePersist`, and a module-level store + `usePersist`: one request each, the saved page shown after it).
- With `persist: "window"`, call `list.setScrollAnchor(id)` for the first visible row and read `list.scrollAnchor` after a reload to restore the scroll position. `setScrollAnchor` changes no tracked state and notifies nothing: the anchor is written with the next store change, so before an immediate reload or navigation call `store.persist.flush()`. Source: `cube/core/pagination.ts` (`setScrollAnchor`), `cube/contract/sliceG/pagination.phase2.test.ts` (J1: `setScrollAnchor` then `persist.flush()`); authoring probe (no listener call, nothing stored until the flush).
- Restored unconfirmed rows keep the list dirty. `list.pendingAdds` names them and `list.discardPendingAdds()` removes them. Give temporary rows an id that starts with `_tmp_` (the format `add()` generates), so a restored list can tell them from server rows.
- `resolve.options.suspense: true` suspends only while the list has nothing to show (the first page, or a new query without `keepPreviousData`). Page changes and `loadMore` keep the rows on screen. In a server render the boundary's fallback is sent and the list renders in the browser.
- To render the first page on the server from rows a Server Component fetched, pass it to the store as `initialData` — an array, or `{ items, total, nextCursor, hasMore }` as the resolver returns it; `nextCursor: null` there makes the first page the whole feed (`cube/core/pagination.test.ts`, "a first page given as initialData with nextCursor: null is a complete feed"). Read the `palistor-ssr` skill first: the rows must answer the query the store would send.
- A paginated list inside a row template paginates each row's instance separately. Its resolver receives the owner row's values, and the owner fields it reads form that instance's query key.

## Common mistakes

### HIGH — Ignoring `ctx.page`

Wrong: `resolver: async () => fetchOrders()` returning every row from a paginated list, or computing the offset from a page number kept in `useState` or in a form field.

Correct: build the request from `ctx.page.offset`, `ctx.page.pageSize` and, in `cursor` / `infinite` mode, `ctx.page.cursor`.

Why: the list calls the resolver once per page and files the result under that page. A resolver that ignores the request returns the same rows for every page. A page number read from form values becomes part of the query key, so every page change discards the cache and restarts at the first page. Source: `cube/contract/sliceG/pagination.test.ts` (A1, B1).

### HIGH — Replacing the rows with a spinner on `list.loading`

Wrong: `if (list.loading) return <Spinner />;` on a paginated list.

Correct: `list.isInitialLoading` for the empty first load; show `list.isFetching` as a small indicator next to the pager and keep rendering the rows.

Why: on a paginated list `loading` is `true` during every page fetch, including a background refetch. The previous rows are still on screen then, and hiding them makes the table blink on each page change. Source: `cube/contract/sliceG/pagination.test.ts` (A3), `cube/core/listCube.ts` (`loading`).

### MEDIUM — "Page N of M" from a new query while the previous rows are shown

Wrong: `<span>Page {list.page} of {list.pageCount}</span>` and `Total: {list.total}` on a list with `keepPreviousData: true`.

Correct: while `list.isPreviousData` is `true`, or while `list.total` is `undefined`, render a pager without the count ("Page 1", or the previous text dimmed).

Why: the kept rows belong to the previous query, but `page`, `pageCount` and `total` already describe the new one, which has no answer yet: the pager reads "Page 1 of 0" over rows of another page. Source: `cube/core/pagination.ts` (`ensureFamily` moves the page and the family at the key change, `pageCount`, `total`); authoring probe.

### MEDIUM — Calling an optional pagination method directly

Wrong:

```ts expect-error=TS2722
import { defineList, Palistor } from "palistor";

interface Order { id: string; title: string }
const orders = defineList<Order>({
  template: { id: { value: "" }, title: { value: "" } },
  resolve: { pagination: { pageSize: 20 }, resolver: async () => ({ items: [], total: 0 }) },
});
const store = new Palistor({ config: { orders } });
store.proxy.orders.setPage(2);
```

Correct: `store.proxy.orders.setPage?.(2)`, or pass the method as a handler: `onClick={list.nextPage}`.

Why: the pagination members are declared optional on the list type, because one type describes paginated and plain lists. Source: `store/store/types.ts` (`ListProxyNode`).

### MEDIUM — Jumping to a page that does not exist

Wrong: `list.setPage?.(n)` with an unchecked `n` from a URL or an input.

Correct: clamp `n` to `1…list.pageCount` (from `base`), or use `nextPage()` / `prevPage()`, which check `hasNextPage` / `hasPrevPage` themselves.

Why: in `paged` mode `setPage` accepts any page from `base` up: a page past the end is fetched and shown empty. In `cursor` mode `setPage` reaches only a cached page or the next one, and in `infinite` mode it is not a navigation at all; both log a warning and do nothing. After a page that came with `nextCursor: null` there is no next one: `setPage` and `prefetch` request nothing. Source: `cube/core/pagination.ts` (`setPage`, `pastEnd`), `cube/core/pagination.test.ts` ("cursor: the page that came with nextCursor: null has no next one; nextPage, setPage and prefetch request nothing").

### MEDIUM — Using `total` to decide whether more rows exist

Wrong: `list.length < list.total` as the "load more" or "next" condition.

Correct: `list.hasNextPage`.

Why: `total` includes local adds and removes; `hasNextPage` and `serverTotal` follow the server only, and in `cursor` / `infinite` mode a page with `nextCursor: null` ends the feed whatever the total says. Source: `cube/contract/sliceG/pagination.test.ts` (A2, D7), `cube/core/pagination.ts` (`hasNextPage`), `cube/core/pagination.test.ts` ("infinite: null wins over a total and a hasMore that say there is more").

### MEDIUM — Reading the list's own rows inside its resolver

Wrong: `resolver: async (values, store, ctx) => { const have = values.orders.length; … }` on the `orders` list.

Correct: use `ctx.page` for position; keep other state in `store.context` or in a form field outside the list.

Why: reading its own rows deep-copies every loaded row on each run, and the read is excluded from the query key, so it cannot drive a refetch. The list logs a warning once. Source: `cube/contract/sliceG/pagination.test.ts` (F7).

### MEDIUM — Mapping a field prop onto a pagination name

Wrong: `fieldMapping: { loading: "isFetching" }` or `{ dirty: "page" }`.

Correct: pick an external name that is not a list member.

Why: the pagination names are reserved list keys; such a mapping throws when the store is created. Source: `cube/contract/sliceG/pagination.test.ts` (F1).
