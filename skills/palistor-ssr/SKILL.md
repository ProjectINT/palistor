---
name: palistor-ssr
description: >
  Use when a palistor form, list or wizard has to be rendered on the server in a
  Next.js App Router project (or any React server render): the first HTML must
  already contain the rows or values a Server Component fetched and the
  translated labels, the server must send no request on behalf of the store,
  hydration must report no mismatch and the browser must not fetch the same data
  again. Also use it when the page source shows translation keys or an empty
  list, when a hydration warning points at a palistor screen, when a store is
  needed per mounted component instead of one per module, or when a Node script
  or a test without a DOM never sees its resolver run. Covers usePalistor,
  PalistorProvider, usePalistorContext, the constructor options initialData,
  translator, notifier and server, store.start(), and loading and Suspense
  during a server render. Requires the palistor skill for config, store and
  useForm basics; the list itself (defineList, filters, pagination) belongs to
  palistor-lists.
metadata:
  purpose: 'Render palistor forms, lists and wizards on the server in Next.js App
    Router: create one store per component instance with usePalistor, hand it
    the data a Server Component fetched through initialData, share context,
    translator and notifier through PalistorProvider, and keep the server render
    free of store requests and the hydration free of mismatches and repeated
    fetches.'
  type: sub-skill
  library: palistor
  library_version: '0.1.0-cube.1'
sources:
  - 'ProjectINT/palistor:cube/palistor.ts'
  - 'ProjectINT/palistor:cube/types.ts'
  - 'ProjectINT/palistor:cube/react/usePalistor.ts'
  - 'ProjectINT/palistor:cube/react/provider.tsx'
  - 'ProjectINT/palistor:cube/core/restore.ts'
  - 'ProjectINT/palistor:cube/core/hub.ts'
  - 'ProjectINT/palistor:cube/core/resolve.ts'
  - 'ProjectINT/palistor:cube/core/pagination.ts'
  - 'ProjectINT/palistor:cube/core/flow.ts'
  - 'ProjectINT/palistor:cube/core/cube.ts'
  - 'ProjectINT/palistor:cube/core/listCube.ts'
  - 'ProjectINT/palistor:cube/core/node.ts'
requires:
  - palistor
---

# Palistor on the server: Next.js App Router

Read the `palistor` skill first: this skill assumes its config → store → `useForm` → spread model. For a list read `palistor-lists` as well, for a wizard `palistor-flows`.

A Client Component renders twice: on the server into HTML, then in the browser during hydration. A store cannot be serialized, so each pass builds its own store from the same props, and both first renders must produce the same markup. Three rules follow:

1. Everything the first render shows goes into the store's constructor: the server's data as `initialData`, the translator, the context. Effects do not run on the server.
2. The server pass starts nothing. Where `window` is not defined a store calls no resolver, fetches no page and enters no flow step. Data access on the server is the Server Component's job.
3. A store that holds data of the current request is created per component instance with `usePalistor`, never at module level.

## Setup

Three files: the Client Component that owns the store, the Server Component that fetches, and a provider in the layout.

```tsx
// app/[accountId]/customers/CustomersView.tsx
"use client";
import { defineList, useForm, usePalistor } from "palistor";
import type { PalistorRef, TranslateFn } from "palistor";

export interface Customer { id: string; name: string }
declare function fetchCustomers(accountId: string, search: string): Promise<Customer[]>; // the browser's API client

// Module level: a config holds no request data. Only the store is per instance.
const customersConfig = {
  customers: defineList<Customer>({
    template: { id: { value: "" }, name: { value: "" } },
    filter: { search: { value: "", label: (t: TranslateFn) => t("customers.search") } },
    resolve: {
      // Never runs on the server. In the browser: when the search changes, or on reload().
      resolver: async (values, store, ctx) =>
        fetchCustomers(String(store.context.accountId), String(ctx.filter.values.search)),
    },
  }),
};

export function CustomersView({ accountId, customers }: { accountId: string; customers: Customer[] }) {
  // One store per component instance. The function is called once.
  const store = usePalistor(() => ({
    config: customersConfig,
    context: { accountId }, // merged over the provider's context
    initialData: { customers }, // the list starts resolved: no request on the server, none after hydration
  }));
  const list = useForm(store).customers;
  const search = list.filter!.search;

  return (
    <section>
      <label>
        {search.label}
        <input value={search.value} onChange={(e) => search.onValueChange(e.target.value)} />
      </label>
      <ul>{list.map((customer, index, id) => <CustomerRow key={id} customer={customer} />)}</ul>
    </section>
  );
}

function CustomerRow({ customer }: { customer: PalistorRef<Customer> }) {
  return <li>{useForm(customer).name.value}</li>;
}
```

```tsx
// app/[accountId]/customers/page.tsx — a Server Component: no "use client", no store
import type { ReactElement } from "react";

interface Customer { id: string; name: string }
declare function getCustomers(accountId: string): Promise<Customer[]>; // your server-side data access
declare function CustomersView(props: { accountId: string; customers: Customer[] }): ReactElement; // the file above

export default async function Page({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const customers = await getCustomers(accountId); // the props end up in the page: only what the user may see
  // key: another account is another component instance, so another store with the new rows.
  return <CustomersView key={accountId} accountId={accountId} customers={customers} />;
}
```

```tsx
// app/Providers.tsx — a client wrapper the root layout renders around {children}
"use client";
import type { ReactNode } from "react";
import { PalistorProvider } from "palistor";

declare function useT(): (key: string) => string; // the app's i18n hook; it must work during the server render
declare function showToast(message: string): void;

export function Providers({ locale, children }: { locale: string; children: ReactNode }) {
  const t = useT();
  return (
    <PalistorProvider translator={t} notifier={showToast} context={{ locale }}>
      {children}
    </PalistorProvider>
  );
}
```

How it runs:

- `usePalistor(options)` or `usePalistor(() => options)` returns the same store on every render of that component instance, and two instances get two stores. The function form is called when the store is created, not on every render; prefer it when building the options costs something.
- The nearest `<PalistorProvider>` is merged into the constructor: `context` is `{ ...provider, ...own }`, `translator` and `notifier` are the store's own option when given, the provider's otherwise. So the first render, the server's included, is translated and resolvers see the context on their first run.
- On the server the store is in server mode (`server`, default `typeof window === "undefined"`): nothing starts. A resolve that will start in the browser reads `loading: true` on both sides, so the two first renders agree.
- A node that got `initialData` is in the state its resolver's result would have left: values, `dirty: false`, `resolveStatus: "resolved"`, `loading: false`, and `reset()` returns to this data. Its resolver is not called on the server and not called after hydration.

Result to check: "View source" shows the customer names and the translated label; the browser console has no hydration error; the Network tab shows no customers request until the search changes.

Source: `cube/ssr/usePalistor.test.tsx`, `cube/ssr/serverMode.test.tsx`, `cube/ssr/hydration.test.tsx`, `cube/ssr/initialData.test.tsx` ("initialData under server render and hydration").

## Core Patterns

### Hand over what the server fetched

`initialData` has the shape of `store.getValues()` with every key optional. A key the data lacks is left alone: that node keeps its default and resolves in the browser.

| Node | Pass | What counts as answered |
| --- | --- | --- |
| Field | its value | the value is also the dirty baseline |
| Group | an object with some of its fields | the group's `resolve`, when the data carries a value for at least one field below it, sub-groups included. An empty object or data that holds only lists does not count: a group resolver never returns lists |
| List | an array of rows, each with `id` | the list's `resolve`; the rows are its membership and baseline |
| List inside a row | the rows under that key of the owner row | that row's list. An owner row without the key loads its list on the first read |
| Paginated list | an array, or `{ items, total?, nextCursor?, hasMore? }` as the resolver returns it | the first page (`pagination.initialPage`) of the current query, filed as a fetched page. Other pages are fetched as usual |
| Flow step | `{ [flowKey]: { [stepKey]: { … } } }` | the step's `resolve`: its first entry runs `onEnter` and then `onReady`, without a request |

```ts
import { defineList, usePalistor } from "palistor";
import type { InitialData } from "palistor";

interface Order { id: string; title: string }
declare function fetchOrders(q: { search: unknown; offset: number; limit: number }): Promise<{ rows: Order[]; count: number }>;

const config = {
  search: { value: "" },
  orders: defineList<Order>({
    template: { id: { value: "" }, title: { value: "" } },
    resolve: {
      pagination: { pageSize: 20 },
      deps: ["search"], // declared: see the second rule below
      resolver: async (values, store, ctx) => {
        const r = await fetchOrders({ search: values.search, offset: ctx.page!.offset, limit: ctx.page!.pageSize });
        return { items: r.rows, total: r.count };
      },
    },
  }),
};

// The type for a prop that carries ready-made data from the Server Component.
export type OrdersData = InitialData<typeof config>;

export function useOrdersStore(firstPage: { rows: Order[]; count: number }) {
  return usePalistor(() => ({
    config,
    initialData: { orders: { items: firstPage.rows, total: firstPage.count } }, // the first page, as the resolver returns it
  }));
}
```

Rules the types do not show:

- **The data must answer the request the store would send now**: the initial filter values, the first page, this context. The store files the rows under its current query and does not check them; a later filter or page change sends a request as usual.
- **Only declared dependencies exist until the first real run.** No resolver has run in the browser, so its reads are unknown. A resolve that got data re-runs on a path in `resolve.deps`, on a key in `contextDeps` (group and field resolves; a paginated list ignores it), on a server filter field, and on `reload()`; a paginated list fetches its other pages as usual. A form value or context key the resolver merely reads does not re-run it: list the value in `deps`. After one real run the usual automatic tracking is back.
- **The context must be there from the start too**: in the `usePalistor` options or the provider. A `contextDeps` key that arrives after mount is a change and re-runs the resolver right after hydration.
- **Read once.** `config`, `initialData`, `initialValues`, `fieldMapping` and `server` are taken when the store is created. New data from the server needs a new component instance: put a `key` on the component.
- **`initialData` exists in the constructor only.** There is no method that adds it later, which is what keeps request data out of a shared store.
- **`initialValues` is not a substitute**: those are defaults. A list does not take rows from them and a node with `resolve` still resolves (Common Mistakes).

Source: `cube/ssr/initialData.test.tsx`, `cube/ssr/initialDataLists.test.tsx`, `cube/ssr/initialDataFlow.test.ts`, `cube/ssr/initialDataDeps.test.ts`, `cube/core/restore.ts`.

### Translate and share context from the first render

- Per store: pass `translator`, `notifier`, `context` to `usePalistor` (or to `new Palistor`).
- For every store below: `<PalistorProvider context translator notifier>`. Nested providers add up: the inner `context` is merged over the outer one, and a `translator` or `notifier` it does not pass is inherited.
- After mount `usePalistor` follows changes of these three values only: the provider's always, the options' when they are passed as an object. A `context` built from props inside the function form does not follow the props; use the object form, or a `key`, for that.
- The context is compared per key: an inline `context={{ locale }}` with the same values is not a change. Keep the translator a stable function: a new one retranslates.
- `usePalistorContext<T>()` reads the provider's `context` in a component and re-renders it when a key changes. It is the provider's value, not a store's: `store.context` also has the store's own keys.
- A store made with `new Palistor` is not touched by the provider. `useTranslator`, `useNotifier` and `useStoreContext` still work for it, but they register in an effect, after the first render.

Source: `cube/ssr/usePalistor.test.tsx` ("the provider's values are in the constructor", "changes after mount reach the store", "PalistorProvider and usePalistorContext"), `cube/react/provider.tsx`.

### Decide what a node without server data shows

A resolve that got no data starts in the browser, after hydration. What the server sends for it:

- Default: `loading` is `true` in the server's HTML and in the browser's first render, so `if (list.loading) return <Skeleton />` gives the same skeleton on both sides (`list.isInitialLoading` on a paginated list). `resolveStatus` is `"idle"` on both sides.
- `resolve.options.suspense: true`: there is no run to wait for on the server, so reading the node's fields or rows there throws, React sends the fallback of the nearest `<Suspense>` boundary and the content renders in the browser. The rest of the page is rendered normally. The boundary is required: without one the error fails the server render.
- After such a fallback the browser mounts the component as on any first mount: a component that reads only the node's fields shows the defaults until the data lands. To avoid that step pass `initialData` (the node then renders on the server), or return a skeleton on `loading` before reading the fields: reading `loading` alone never triggers the fallback.
- The thrown error carries the digest Next.js uses for "render this boundary in the browser" (`BAILOUT_TO_CLIENT_SIDE_RENDERING`), so Next sends the fallback without logging. With another server renderer the error reaches the server's `onError`, and hydration reports one recoverable error for the boundary.

Source: `cube/ssr/hydration.test.tsx`, `cube/ssr/suspense.test.tsx`, `cube/contract/sliceC/listResolve.test.ts` (`resolveStatus` and `loading` before the first run), `cube/core/resolve.ts` (`clientOnly`).

### Keep a draft over the server's data

`usePersist` reads the storage in an effect. The constructor applies `initialData`, the first render and hydration show the server's data, and after mount the saved draft is laid over it: stored values win, values the draft lacks stay, a stored list replaces the membership. The server's data remains the baseline of the fields, so the restored form is `dirty` and `reset()` returns to what the server sent. No resolver runs because of the draft. Source: `cube/ssr/persistOverInitialData.test.tsx`.

### Run a store without a browser

A Node script or a test with a `node` environment has no `window`, so the store is in server mode there too.

```ts
import { Palistor } from "palistor";
import type { ResolveErrorContext } from "palistor";

declare function loadProfile(): Promise<{ name: string }>;

const store = new Palistor({
  config: {
    profile: {
      name: { value: "" },
      resolve: {
        resolver: async () => loadProfile(),
        onError: (error: unknown, ctx: ResolveErrorContext) => ctx.notify("Could not load the profile"),
        options: { lazy: false },
      },
    },
  },
});

store.start(); // runs what the constructor runs in a browser; calling it again does nothing
```

- `store.start()` enters each flow's active step and starts the eager resolves and every resolve that was read (or reloaded) before it. A lazy resolve nobody has read still waits for its first read.
- `new Palistor({ config, server: false })` makes the store behave as in the browser from the start. `server: true` gives a jsdom test the server's behavior.
- `start()` is not a way to load data during a server render: the render does not wait for the resolvers. Fetch in the Server Component and pass `initialData`.

Source: `cube/ssr/serverMode.test.tsx` ("store.start()", "server: false in Node behaves like the client").

## Common Mistakes

### CRITICAL — A module-level store for request data

Wrong — the module is evaluated once per server process, so every request and every user shares this store:

```text
export const customersStore = new Palistor({ config });          // module level
export function CustomersView({ customers }) {
  customersStore.set(customers);                                   // one user's rows, visible to the next request
  customersStore.proxy.customers.setItems(customers.map((c) => c.id));
```

Correct: `const store = usePalistor(() => ({ config, initialData: { customers } }))` in the Client Component, as in Setup. A module-level store stays fine for state that holds no request data.

Why: `initialData` is accepted by the constructor only, and `usePalistor` builds one store per component instance. Source: `cube/palistor.ts` (constructor), `cube/ssr/usePalistor.test.tsx` ("two components with the same config get different stores").

### HIGH — Translator, notifier or context applied through an effect

Wrong: `useTranslator(store, t)` / `useStoreContext(store, { accountId })` for a screen rendered on the server. The HTML shows `customers.search` instead of the label, and a resolve that got `initialData` and lists `accountId` in `contextDeps` requests its data again right after hydration.

Correct: `usePalistor(() => ({ config, translator: t, context: { accountId } }))`, or a `<PalistorProvider>` above.

Why: the hooks register in `useEffect`, which never runs on the server and runs after the first render in the browser. Constructor values are there before the tree is built; a context key that appears later is a change of that key. Source: `cube/ssr/hydration.test.tsx` ("a label through `translator`"), `cube/ssr/usePalistor.test.tsx` ("the provider's translator is applied in the first render"), `cube/ssr/initialDataDeps.test.ts` ("restarts when a `contextDeps` key changes"), `cube/react/useTranslator.ts`.

### HIGH — Server data passed as `initialValues`

Wrong — for a typed list this does not compile, and with a cast the list still ignores the rows:

```ts expect-error=TS2345
import { defineList, usePalistor } from "palistor";

interface Customer { id: string; name: string }
const config = { customers: defineList<Customer>({ template: { id: { value: "" }, name: { value: "" } } }) };

export function useCustomersStore(customers: Customer[]) {
  return usePalistor(() => ({ config, initialValues: { customers } }));
}
```

Correct: `initialData: { customers }`.

Why: `initialValues` are defaults for fields. A list takes no rows from them, and a group with `resolve` that got `initialValues` still resolves: the server sends the skeleton and the browser requests the data. `initialData` is a result: it also marks the resolve as answered. When both are given, `initialData` is applied over `initialValues`. Source: `cube/palistor.ts` (constructor), `cube/core/restore.ts`, `cube/ssr/initialData.test.tsx` ("the data is applied over initialValues").

### HIGH — Expecting new props to replace the store's data

Wrong: the Server Component re-renders with other rows (another route param, `router.refresh()`, a search param) and the same mounted `CustomersView` is expected to show them.

Correct: `<CustomersView key={accountId} … />`: a key made of what the data depends on. Or keep the screen mounted and let the list's resolver load the change.

Why: the store is created once per component instance; `initialData` and `config` are read then and never again. Only `context`, `translator` and `notifier` are followed. Source: `cube/ssr/usePalistor.test.tsx` ("an options object is read once too", "options passed as an object are followed too: context, translator and notifier, nothing else").

### HIGH — A resolver dependency that is not declared

Wrong: `resolver: async (values) => fetchOrders(values.search)` on a resolve that got `initialData`, expecting a change of `search` to reload the list.

Correct: add `deps: ["search"]`, or make `search` a server field of the list's `filter` block.

Why: automatic tracking records what a run read, and no run has happened in the browser yet. Until the first real run the resolve restarts only on what the config declares. Source: `cube/ssr/initialDataDeps.test.ts` ("does not restart on a value or a context key it did not declare, before its first real run").

### HIGH — Server data that answers another request

Wrong: the Server Component fetches page 2 or rows filtered by a search param, while the store starts on its first page with default filter values.

Correct: fetch on the server with exactly what a new store starts with: its first page (`pagination.initialPage`), the default values of its filter fields, the same `context`.

Why: the rows are filed under the store's current query without a check, and that query counts as already requested. The screen shows rows that do not match its controls, and no request corrects them until a control changes. Source: `cube/core/pagination.ts` (`accept`), `cube/ssr/initialDataLists.test.tsx` ("no request right after construction; a filter change is one request for the first page").

### MEDIUM — Rows without `id`

Wrong: `initialData: { customers: rows }` where a row has no `id` (or an empty one).

Correct: every row carries its `id`.

Why: such a row gets a temporary `_tmp_…` id, generated separately on the server and in the browser. Anything rendered from the id differs between the two passes. Development builds warn once per list. Source: `cube/ssr/initialData.test.tsx` ("a row without an id is reported once per list").

### MEDIUM — Waiting for a resolver where there is no `window`

Wrong: a Vitest or Jest test with a `node` environment, or a script, that reads `list.items` and awaits rows; or code that expects a flow's `onEnter` there.

Correct: `store.start()` after creating the store, or `server: false` in its options. jsdom tests need neither.

Why: without `window` the store is in server mode: `loading` reads `true` and nothing is called. Source: `cube/ssr/serverMode.test.tsx` ("construction starts nothing", "store.start()").

## Completion

1. `npx tsc --noEmit` passes. An error on `initialData` means the data does not match the config: a key the config lacks, a wrong value type, rows keyed by id instead of an array.
2. The page source (not the DOM inspector) contains the server's rows or values and translated texts, and no translation key.
3. Nothing in the server log or the server's outgoing requests comes from a store resolver.
4. The browser console shows no hydration error and no `[palistor] initialData:` warning (an unknown key, a row without `id`).
5. The Network tab shows no request for the data that came as `initialData` until a declared dependency, a filter field or the page changes.
6. Change each input the resolver depends on: the data reloads once. If it does not, the dependency is not declared.

If the HTML has keys instead of texts, the translator comes from an effect. If the HTML has a skeleton instead of rows, the data did not reach the constructor as `initialData` or does not match the config's keys.
