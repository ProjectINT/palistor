# Sorting a list

A `sort` block on `defineList` lets the user order the rows, typically by clicking a column header. Like `filter`, it is view state next to the list: it is not part of the form's values. A list without the block has no `list.sort` and behaves as before.

Who sorts depends on who holds the rows. A list without `resolve.pagination` holds all of them and sorts them itself, in the browser, without a request (the client class). A paginated list holds one page, so its server sorts it, and so does a plain list declared with `$server: true` (the server class, "Server-side sorting" below). The block, `list.sort` and the header component are the same for both.

## Sort by a header click

The base case: one line of config, one header component that calls `useForm(sort)`.

```tsx
import type { ReactNode } from "react";
import { defineList, Palistor, useForm } from "palistor";
import type { PalistorList, PalistorRef, SortProxyNode } from "palistor";

interface Product { id: string; title: string; price: number; rating: number | null }
type ProductKey = keyof Product & string; // a flat entity; with object fields use SortKey<Product>
declare function fetchProducts(): Promise<Product[]>;

const products = defineList<Product>({
  template: { id: { value: "" }, title: { value: "" }, price: { value: 0 }, rating: { value: null as number | null } },
  sort: true, // every template field sorts by its value
  resolve: { resolver: async () => fetchProducts() },
});
export const store = new Palistor({ config: { products } });

export function ProductsScreen() {
  return <ProductsTable products={useForm(store).products} />;
}

function ProductsTable({ products }: { products: PalistorList<Product> }) {
  const list = useForm(products);
  const sort = list.sort!; // typed optional, like `filter`: present because the block is declared
  return (
    <table>
      <thead>
        <tr>
          <SortHeader sort={sort} column="title">Title</SortHeader>
          <SortHeader sort={sort} column="price">Price</SortHeader>
          <SortHeader sort={sort} column="rating">Rating</SortHeader>
        </tr>
      </thead>
      <tbody>{list.map((row, index, id) => <ProductRow key={id} product={row} />)}</tbody>
    </table>
  );
}

function SortHeader({ sort, column, children }: { sort: SortProxyNode<ProductKey>; column: ProductKey; children: ReactNode }) {
  const s = useForm(sort); // its own subscription: re-renders when the sort changes, not when a row does
  const dir = s.dirOf(column); // "asc" | "desc" | null
  return (
    <th aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}>
      <button onClick={() => s.toggle(column)}>
        {children}{dir === "asc" ? " ▲" : dir === "desc" ? " ▼" : ""}
      </button>
    </th>
  );
}

function ProductRow({ product }: { product: PalistorRef<Product> }) {
  const p = useForm(product);
  return <tr><td>{p.title.value}</td><td>{p.price.value}</td><td>{p.rating.value ?? ""}</td></tr>;
}
```

How it runs:

- `toggle(key)` steps none → ascending → descending → back to the `$default` state (no sort without one: the list's own order). Another key starts at ascending. When descending is itself the `$default` state, the next step is ascending, so a `$default` on the same key does not get stuck.
- `items`, `map`, `length` and iteration follow the sort; `map`'s `index` is the position on screen. `getById`, `getValues()`, `dirty`, `store.getValues()` and the submit payload keep the list's own order. With a client filter, the filter narrows the sorted rows and keeps their order.
- A client sort calls no resolver: a sort change requests nothing, and the resolver's `ctx.sort.by` is empty.
- Re-rendering: a header that calls `useForm(sort)` re-renders when the sort state changes. When the order changes, the list component re-renders, and with it the headers and every row component, unless the row is wrapped in `React.memo` (the row node is the same object from render to render, so `memo` keeps unchanged rows out). A value edit re-renders that row only. A sort change that leaves the order as it was re-renders the headers alone.
- The sort is outside the form: not in `getValues()`, the submit payload or a persisted draft, and `store.reset()` keeps it. `sort.reset()` returns to `$default`, `sort.clear()` to no sort.

Source: `cube/core/sort.test.ts` ("toggle", "a projection over the membership", "the resolver", "outside the form"), `cube/react/sort.react.test.tsx` ("a sortable table: who re-renders", with a `memo` row), `cube/core/listCube.ts` (`visibleIds`).

## Choose the sortable fields

`sort: true`, or a block with no field (only `$` options), makes every leaf of the template sortable, a leaf in a group as a dotted path (`"address.city"`); a nested list is not a key. A block that names at least one field makes only the named ones sortable.

| In the block | Meaning |
| --- | --- |
| `title: true` | By the field's value (default comparison, below). Both classes. |
| `lastName: { by: (row: Order) => … }` | By a value computed from the registry row. Client class only. |
| `priority: { compare: (a: Order, b: Order) => number }` | By your own order of two rows; descending negates it. Client class only. |
| `createdAt: { param: "created_at" }` | The name the resolver gets in `ctx.sort.by[i].param` (default: the key). Server class only. |
| `$default: "price"` / `"-price"` | The sort when the store is created (`-` for descending): the list is ordered by it from its first load. `reset()` and the toggle cycle return to it. |
| `$locale: "de"` | The locale of the string comparison. Client class only; set it when the list is rendered on the server (below). |
| `$server: true` | A plain list whose resolver sorts (it returns "the first N in this order"). Needs a resolver. |

```ts
import { defineList } from "palistor";
import type { SortBlock } from "palistor";

interface Order { id: string; createdAt: string; amount: number; lastName: string; firstName: string; priority: "low" | "high" | "urgent" }
const RANK: Record<Order["priority"], number> = { low: 0, high: 1, urgent: 2 };

export const orders = defineList<Order>({
  template: {
    id: { value: "" }, createdAt: { value: "" }, amount: { value: 0 },
    lastName: { value: "" }, firstName: { value: "" }, priority: { value: "low" },
  },
  sort: {
    $default: "-createdAt", // newest first from the first load
    createdAt: true, // ISO strings: text order is time order
    amount: true,
    lastName: { by: (row: Order) => `${row.lastName} ${row.firstName}` }, // the key names an entity field
    priority: { compare: (a: Order, b: Order) => RANK[a.priority] - RANK[b.priority] },
  },
});

// A block declared on its own: `SortBlock<T>`. A field inside an object field is a dotted path, sorted with `by`.
interface Customer { id: string; name: string; address: { city: string } }
export const customerSort: SortBlock<Customer> = {
  $default: "address.city",
  "address.city": { by: (row: Customer) => row.address.city },
  name: true,
};
```

- With `defineList<TEntity>` every key of the block must be a sort key of the entity (`SortKey<TEntity>`), also for a `{ by }` or `{ compare }` field whose value is computed: name it after the entity field it stands for. The runtime would accept any name; the types do not (TS2353).
- `id` is always sortable when the block names it, with or without an `id` leaf in the template.
- A dotted key such as `"address.city"` names a leaf in a template group. A typed `defineList<TEntity>` template cannot declare a group (TS2353), so there an object field is one leaf holding the object (`address: { value: { city: "" } }`), and a client value sort `"address.city": true` throws when the store is created: it is not a template leaf. Sort such a field with `{ by }`, as `customerSort` does.
- Calling `toggle`, `set` or `onSortChange` with a key that does not sort throws `unknown sort key`; `dirOf` returns `null` for it.

These throw when the store is created: an unknown `$` option, `$default` by a key that does not sort, a value sort (`true`) by a key that is not a template leaf (client class), `by` together with `compare`, an unknown field option, a field value other than `true` or an object, an invalid `$locale`, and an option of the other class (`by`, `compare` or `$locale` on a server list, `param` on a client list, `$server: true` without a resolver, `$server: false` on a paginated list). Source: `cube/core/sort.ts` (`parse`), `cube/core/sort.test.ts` ("config that can never apply throws when the store is created"), `cube/core/sortServer.test.ts` ("a server sort's block"), `store/store/types.ts` (`SortBlock`, `SortKey`).

## How values compare

These rules are the client class's, for a value sort and a `{ by }` field; a server sorts by its own rules. A `{ compare }` function gets the two rows and decides everything itself, empty values included; descending still negates its result, and ties keep the list's order.

- Numbers as numbers; `false` before `true`; a `Date` returned by `by` by time.
- Strings through `Intl.Collator` with `numeric: true` and `sensitivity: "base"`: "Item 2" before "Item 10", case and accents ignored.
- Values of different types compare as text.
- Empty values go last in both directions: `null`, `undefined`, `""`, `NaN` and an invalid date. A row that lacks the key reads the template default, so it is empty when the default is `null` or `""`.
- The sort is stable: equal rows keep the list's own order, in both directions. Descending negates the comparison; it does not reverse the array.
- A `Date` object does not survive the entity registry (it is stored as `{}`). Keep dates as ISO strings or timestamps in the rows, and use `{ by: (row: Event) => new Date(row.day) }` for another string format.

Source: `cube/core/sort.ts` (`compareValues`, `isSortEmpty`, `templateLeaves`, `comparator`), `cube/core/sort.test.ts` ("comparison by value", "dates by time: a `by` that returns a Date, and ISO strings stored in the row"); the `Date` storage: an authoring probe (`store.set` of a row with a `Date` reads back `{}`, and sorting by it keeps the list's order).

## The order is a snapshot

In the client class the order is computed at these moments only: a sort action (`toggle`, `set`, `clear`, `reset`, `onSortChange`), a resolve landing (`reload()` included), `setItems`, a restore (`initialData`, a draft restored by `usePersist`), and `sort.refresh()`. In between, no value is compared:

- a row that joins the list (`add`, `add(id)`) goes to the end;
- a value edit moves nothing: an inline edit, or `store.set` from a realtime update;
- a row that leaves (`remove`, `store.delete`) is taken out, the others stay in place; `store.rekey` keeps the row's place.

So after edits the header can show ▲ while a row is out of place. Call `refresh()` to order the rows again by their current values, the sort state as it is: from a "Re-sort" button, or after applying a batch of realtime updates. A `refresh()` with nothing to move notifies nothing.

```tsx
import { useForm } from "palistor";
import type { SortProxyNode } from "palistor";

export function ResortButton({ sort }: { sort: SortProxyNode }) {
  const s = useForm(sort);
  return <button disabled={s.key === null} onClick={() => s.refresh()}>Re-sort</button>;
}
```

Source: `cube/core/sort.test.ts` ("the order is a snapshot"), `cube/react/sort.react.test.tsx` ("a value edit in the sorted column re-renders that row only, in place; refresh() moves it and re-renders the table, no row"), `cube/core/listCube.ts` (`ids` setter, `setItems`, `restore`).

## Page through a sorted list in memory

The library has no client-side pagination: slice what `map` renders. The order filter → sort → page then comes by itself, and a sort applies to every row, not only to the page on screen.

```tsx
import { useState } from "react";
import { useForm } from "palistor";
import type { PalistorList, PalistorRef } from "palistor";

interface Product { id: string; title: string }
const PAGE_SIZE = 20;

export function ProductPages({ products }: { products: PalistorList<Product> }) {
  const list = useForm(products);
  const [page, setPage] = useState(1);
  const rows = list.map((row, index, id) => <ProductRow key={id} product={row} />); // filtered, then sorted
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pageCount); // a filter can shrink the list under the current page
  return (
    <>
      <ul>{rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)}</ul>
      <button disabled={current <= 1} onClick={() => setPage(current - 1)}>Previous</button>
      <span>Page {current} of {pageCount}</span>
      <button disabled={current >= pageCount} onClick={() => setPage(current + 1)}>Next</button>
    </>
  );
}

function ProductRow({ product }: { product: PalistorRef<Product> }) {
  return <li>{useForm(product).title.value}</li>;
}
```

## Render it on the server: `$locale`

The collator's default locale is the environment's. A server and a browser with different defaults order non-ASCII strings differently (German puts "Äpfel" first, Swedish last), and hydration fails on the first render. Give a client-sorted list rendered on the server a fixed `$locale` (the app's locale): both sides then produce the same order. A list that got its rows as `initialData` is ordered by `$default` from the first render, on the server and in the browser. Source: `cube/ssr/sortLocale.test.tsx` ("$locale: the same order on the server and in the browser").

## HeroUI and React Aria tables

`list.sort` carries the `Table` props: `sortDescriptor` (`undefined` while unsorted) and `onSortChange`. A press on the sorted column asks React Aria for the other direction, and `onSortChange` runs the `toggle` cycle for it, so the third press clears the sort (or returns to `$default`). Give `allowsSorting` only to columns whose `key` is a sort key: an unknown key throws.

React Aria builds the table body from `<TableRow>` and `<TableCell>` elements itself (its collection builder reads `getCollectionNode` from each element's type), so a row component of your own that calls `useForm(row)` and returns a `TableRow` is rejected. Keep `TableRow` in `TableBody` and call `useForm(row)` in a cell component.

```tsx
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from "@heroui/react";
import { useForm } from "palistor";
import type { PalistorList, PalistorRef } from "palistor";

interface Product { id: string; title: string; price: number }
type Column = "title" | "price";
const COLUMNS: Column[] = ["title", "price"];

export function ProductsGrid({ products }: { products: PalistorList<Product> }) {
  const list = useForm(products);
  const sort = list.sort!;
  return (
    <Table aria-label="Products" sortDescriptor={sort.sortDescriptor} onSortChange={sort.onSortChange}>
      <TableHeader>
        {COLUMNS.map((column) => <TableColumn key={column} allowsSorting>{column}</TableColumn>)}
      </TableHeader>
      <TableBody>
        {list.map((row, index, id) => (
          <TableRow key={id}>
            {COLUMNS.map((column) => <TableCell key={column}><ProductCell product={row} column={column} /></TableCell>)}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ProductCell({ product, column }: { product: PalistorRef<Product>; column: Column }) {
  const p = useForm(product); // an edit re-renders the cells of this row
  return <>{column === "title" ? p.title.value : p.price.value}</>;
}
```

Source: `cube/core/sort.test.ts` ("sortDescriptor / onSortChange (React Aria, HeroUI)"), `cube/react/sort.react.test.tsx` (type checks against the `Table` props); the row rule: `@react-stately/collections` (`CollectionBuilder`), as used by `@heroui/table` 2.2.

## Server-side sorting

A paginated list holds one page, so its server sorts it. A plain list whose resolver returns only "the first N in this order" declares `$server: true` for the same reason. The resolver reads the sort from `ctx.sort` and sends it with the request; the header, `toggle` and the HeroUI props stay as above.

```ts
import { defineList } from "palistor";

interface Order { id: string; title: string; amount: number; createdAt: string }
declare function fetchOrders(q: {
  orderBy: Array<{ column: string; ascending: boolean }>; offset: number; limit: number;
}): Promise<{ rows: Order[]; count: number }>;

export const orders = defineList<Order>({
  template: { id: { value: "" }, title: { value: "" }, amount: { value: 0 }, createdAt: { value: "" } },
  sort: { $default: "-createdAt", title: true, amount: true, createdAt: { param: "created_at" } },
  resolve: {
    pagination: { pageSize: 20 },
    resolver: async (values, store, ctx) => {
      const page = ctx.page!;
      const r = await fetchOrders({
        orderBy: ctx.sort.by.map((s) => ({ column: s.param, ascending: s.dir === "asc" })), // [] while unsorted
        offset: page.offset,
        limit: page.pageSize,
      });
      return { items: r.rows, total: r.count };
    },
  },
});
```

- `ctx.sort` is `{ by: [{ key, param, dir }], key }`, first entry first; `param` is the key unless the field declares `{ param }`. It is `{ by: [], key: "" }` while nothing is sorted, for a client sort and on a list without a block. The package's `ListResolveContext` types `sort` as always present.
- The list shows the rows in the order the resolver returned them and never reorders them itself: `sort.refresh()` does nothing here. To fetch again, call `list.reload()`.
- A sort change is one request. A paginated list puts the sort into its query key: it starts over at its first page (`initialPage`); with `keepPreviousData` the old rows stay on screen with `isPreviousData`; with `maxCachedQueries` above 1 a sort whose first page is still cached, and within `staleTime`, is shown without a request; an `infinite` window goes back to its first page. Presses in quick succession on a paginated list fetch once each, and only the last answer is shown. A plain `$server: true` list runs its resolver again; changes while a run is in flight cause one more run, with the latest sort.
- Setting the sort the list already has requests nothing. A list that has not loaded yet requests nothing for a sort change; its first load sends the current sort.
- Without a server sort (nothing sorted), `ctx.queryKey` and `ctx.page.queryKey` are what a list without a sort block gets.
- With a server filter: a sort change while a filter field's `debounce` is running carries the pending value in the same request, and the debounce then sends nothing (`filter.isPending` stays `true` until it runs out). There is no public way to group a filter change and a sort change: `filter.set(…)` or `filter.apply()` followed by `sort.toggle(…)` in one handler is two requests (on a paginated list the second replaces the first; a plain list runs once more after the first run lands).
- `initialData` answers the sort the store starts with: the rows must already be in the `$default` order. There is no request after construction, and the first sort change is one request. See the `palistor-ssr` skill.
- The sort state is never persisted. A window saved by `usePersist` under another sort is not restored for a store that starts at `$default`: it fetches.
- A custom `pagination.queryKey` replaces the whole automatic key, the sort included: a sort change then sends no request, and the rows keep their old order under the new header. Do not combine a server sort with `queryKey`.

Source: `cube/core/sort.ts` (header, `serverKey`, `request`, `launch`, `markIssued`, `check`), `cube/core/pagination.ts` (`SORT_DEP`, `commitKeys`, `invalidate`, `keyFromPairs`, `retrigger`), `cube/core/resolve.ts` (`invalidate`), `cube/core/listCube.ts` (`resolveContext`), `cube/core/restore.ts`, `cube/core/sortServer.test.ts`, `cube/ssr/initialDataLists.test.tsx` ("initialData: a paginated list with a server sort"); `queryKey`: `cube/core/pagination.ts` (`computeKey`) and a release-audit probe; two requests for a filter change and a sort change in one handler, and one request per quick press on a paginated list: authoring probe.

## Typing

- `list.sort` is typed optional: `list.sort!` on a list that declares the block.
- A header prop: `SortProxyNode<keyof Product & string>` for a flat entity, `SortProxyNode<SortKey<Product>>` when the entity has object fields (their fields are dotted paths, and the object field's own name is not a key). An untyped `SortProxyNode` accepts any list's sort.
- `useForm(sort)` returns the same type. Take `sort` from a `useForm` result: a raw `store.proxy.products.sort` throws `useForm: received a raw store proxy node`, as any raw node.
- Inside `defineList<TEntity>` the `by` and `compare` rows are typed from `TEntity`, and the resolver's `ctx` has `sort` as always present; a resolver declared outside takes `ctx: ListResolveContext`.
- `SortBlock<T>`, `SortKey<T>`, `SortDirection`, `SortRequest` and `SortProxyNode<K>` are exported from `"palistor"`.

Source: `store/store/types.ts` (`SortProxyNode`, `SortKey`, `ListProxyNode.sort`, `ListResolveContextWithSort`), `cube/index.ts`, `cube/types.ts` (`UseForm`), `cube/react/sort.react.test.tsx` (type checks, "a raw list.sort from store.proxy is refused").

## Limits

- One sort key at a time. `by` is an array so that a multi-column sort can be added later.
- Root lists only: a `sort` block on a list nested in a row is ignored with a console warning.
- The sort state is not persisted and has no slot in `initialData`: set the starting sort with `$default`.
- A `fieldMapping` leaves the block as written: its keys and options are not field props.

Source: `cube/core/sort.ts` (`warnNestedSorts`, header comment), `cube/core/sort.test.ts` ("a sort on a nested (per-entity) list is ignored with a warning", "fieldMapping").

## Common mistakes

### HIGH — Sorting rows in the component

Wrong: `useState` for the sort key and `useMemo(() => [...rows].sort(...))` in the render, often after slicing out the current page.

Correct: a `sort` block, a header that calls `sort.toggle(key)`, and `list.map(...)` (sliced for client-side pages, as above).

Why: sorting after the slice orders the page on screen, not the list: page 1 sorted by price is not the cheapest rows. A hand-written comparator also loses what the block does: empty values last in both directions, a stable order, numeric and case-insensitive strings, the snapshot, the order under a client filter. Source: `cube/core/listCube.ts` (`visibleIds`: the client filter over the sort's order), `cube/core/sort.test.ts` ("comparison by value", "the client filter narrows the sorted rows and keeps their order").

### HIGH — Sorting in the browser what only the server has

Wrong: `sort: true` on a plain list whose API returns the first 50 rows; a `useMemo` sort of the page a paginated list shows; `{ by }` or `{ compare }` on a paginated list.

Correct: a paginated list sorts on the server as is; a plain list that holds only the first N declares `$server: true`. Either way the resolver sends `ctx.sort.by` to the API.

Why: a client sort orders the rows the list holds: the first 50, or one page. `{ by }`, `{ compare }` and `$locale` on a server list throw when the store is created, since the browser never orders its rows. Source: `cube/core/sort.ts` (`parse`), `cube/core/sortServer.test.ts` ("a server sort's block").

### HIGH — A server-sorted list whose resolver ignores `ctx.sort`

Wrong: a paginated list with a `sort` block and `resolver: async (values, store, ctx) => fetchOrders({ offset: ctx.page!.offset, limit: ctx.page!.pageSize })`.

Correct: pass `ctx.sort.by` (each entry's `param` and `dir`) to the API, as in "Server-side sorting".

Why: the header changes and a request goes out, but the rows come back in the same order: a server list never reorders them itself, and `refresh()` does nothing there. Source: `cube/core/sortServer.test.ts` ("a server sort never reorders the loaded rows itself"), `cube/core/sort.ts` (`resort`).

### HIGH — Expecting an edited or added row to move into place

Wrong: relying on a client-sorted list to re-order itself after an inline edit, a realtime `store.set` or a `list.add`.

Correct: call `list.sort!.refresh()` (a "Re-sort" button, or after a batch of updates), or let the next sort action or resolve order the rows.

Why: the order is a snapshot: an edit moves nothing and a new row goes last until the next recompute, so a row can sit out of place under a ▲ header. Source: `cube/core/sort.test.ts` ("a value edit in the sorted column moves nothing and keeps the items array; refresh() puts the row in place", "add: the new row goes to the end; a toggle puts it in place").

### MEDIUM — No `$locale` on a client-sorted list rendered on the server

Wrong: a sorted list in a server-rendered page with `sort: { $default: "title", title: true }`.

Correct: `sort: { $default: "title", $locale: "de", title: true }`, with the app's locale.

Why: without it each side compares strings in its own default locale; non-ASCII titles come out in another order and hydration fails. Source: `cube/ssr/sortLocale.test.tsx`.

### MEDIUM — `Date` objects in a sorted column

Wrong: rows that carry `createdAt: new Date(...)`.

Correct: ISO strings or timestamps in the rows; a `by` that builds the `Date` when the stored text does not sort by time.

Why: the registry stores a `Date` as `{}`: every row compares equal and the column keeps the list's order. Source: `cube/core/sort.test.ts` (comment on "dates by time…"), authoring probe (above).

### MEDIUM — A header prop typed with `keyof` on an entity with object fields

Wrong: `sort: SortProxyNode<keyof Customer & string>` where `Customer` has `address: { city: string }`.

Correct: `sort: SortProxyNode<SortKey<Customer>>`.

Why: the sort keys of such an entity are `"address.city"`, not `"address"`, so `list.sort!` is not assignable (TS2322). Source: `store/store/types.ts` (`SortKey`).

### MEDIUM — A computed column named after no entity field

Wrong:

```ts expect-error=TS2353
import { defineList } from "palistor";

interface Person { id: string; firstName: string; lastName: string }
export const people = defineList<Person>({
  template: { id: { value: "" }, firstName: { value: "" }, lastName: { value: "" } },
  sort: { fullName: { by: (row: Person) => `${row.lastName} ${row.firstName}` } },
});
```

Correct: name the column after the entity field it stands for, `lastName: { by: (row: Person) => … }`, and use that key in `toggle`.

Why: the block of `defineList<TEntity>` takes the sort keys of `TEntity` only, although the runtime accepts any name for a `{ by }` or `{ compare }` field. Source: `store/store/types.ts` (`SortBlock`), `cube/core/sort.ts` (`parse`).
