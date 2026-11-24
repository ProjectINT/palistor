---
name: palistor-lists
description: >
  Use when a React screen built with palistor needs a collection of records: a
  table, list or grid of rows loaded from an API with loading, error, empty and
  retry states; adding, removing or inline-editing rows; optimistic rows whose
  temporary id is later replaced by the server id; a detail or edit form for one
  record; sorting the rows by a clicked column header, in the browser or by the
  API; search and filter controls over the rows, server-side or in memory,
  applied as the user types or with an Apply button; or page-by-page, load-more
  and cursor pagination. Covers defineList, list and row (entity) proxies,
  useForm on a row, store.set / rekey / delete / invalidate, list filter and
  sort blocks and resolve.pagination. Requires the palistor skill for config,
  store and useForm basics. Step-by-step wizards belong to palistor-flows;
  renaming field props for a UI kit belongs to palistor-field-mapping; rendering
  the list on the server in Next.js belongs to palistor-ssr.
metadata:
  purpose: 'Teaches how to model collections in Palistor: declaring a typed list
    with defineList, rendering and editing its rows through entity proxies,
    loading it with a resolver (loading, error, reload), mutating membership
    (add, remove, temporary ids and rekey), editing one entity through a
    separate template, and filtering, sorting or paginating the list.'
  type: sub-skill
  library: palistor
  library_version: '0.1.1-cube.3'
sources:
  - 'ProjectINT/palistor:cube/defineList.ts'
  - 'ProjectINT/palistor:cube/core/listCube.ts'
  - 'ProjectINT/palistor:cube/core/registry.ts'
  - 'ProjectINT/palistor:cube/core/filter.ts'
  - 'ProjectINT/palistor:cube/core/sort.ts'
  - 'ProjectINT/palistor:cube/core/pagination.ts'
  - 'ProjectINT/palistor:cube/core/resolve.ts'
  - 'ProjectINT/palistor:cube/core/node.ts'
  - 'ProjectINT/palistor:cube/core/hub.ts'
  - 'ProjectINT/palistor:cube/core/cube.ts'
  - 'ProjectINT/palistor:cube/react/useForm.ts'
  - 'ProjectINT/palistor:cube/react/usePalistor.ts'
  - 'ProjectINT/palistor:react/useForm.ts'
  - 'ProjectINT/palistor:store/defineList.ts'
  - 'ProjectINT/palistor:store/store/types.ts'
  - 'ProjectINT/palistor:store/pagination/types.ts'
requires:
  - palistor
---

# Palistor lists and entities

Read the `palistor` skill first. This skill assumes its config → store → `useForm` → spread model (leaf and group nodes, `new Palistor({ config })`, a module-level store) and does not repeat it.

## Setup

A list is one config node: `defineList<TEntity>({ template, resolve?, filter?, sort? })`. The template is the set of field rules shared by every row. Rows are stored once, in an entity registry keyed by `id`; a list holds ids, so the same row can appear in several lists and forms.

```tsx
import { defineList, Palistor, useForm } from "palistor";
import type { PalistorRef } from "palistor";

interface User { id: string; name: string; role: string }
declare function fetchUsers(query: string): Promise<User[]>;

const users = defineList<User>({
  template: {
    id: { value: "" }, // required: the registry key
    name: { value: "", validate: (v) => (v.trim() ? undefined : "Name is required") },
    role: { value: "viewer" },
  },
  resolve: {
    // Every value read here is a dependency: the list re-fetches when `query` changes.
    resolver: async (values) => fetchUsers(values.query),
    onError: (error, { notify }) => notify("Could not load users"),
  },
});

export const store = new Palistor({ config: { query: { value: "" }, users } });

export function UsersTable() {
  const form = useForm(store);
  const list = form.users;
  const count = list.length; // this read starts the lazy load: keep it above every early return

  if (list.resolveStatus === "error") return <button onClick={list.reload}>Retry</button>;
  if (list.resolveStatus !== "resolved") return <p>Loading…</p>; // "idle" on the first render, then "pending"
  if (count === 0) return <p>No users</p>;
  return <ul>{list.map((user, index, id) => <UserRow key={id} user={user} />)}</ul>;
}

function UserRow({ user }: { user: PalistorRef<User> }) {
  const u = useForm(user); // the row's own subscription: an edit re-renders this row only
  return (
    <li>
      <input value={u.name.value} onChange={(e) => u.name.onValueChange(e.target.value)} />
      {u.name.isInvalid && <em>{u.name.errorMessage}</em>}
    </li>
  );
}
```

How it runs:

- The resolve is lazy. It starts on the first read of `list.items`, `list.length`, `list.map` or `list.loading` (also `list.values` on a filtered list and `list.isInitialLoading` on a paginated one), one microtask later. `error` and `resolveStatus` never start it. `resolve.options.lazy: false` starts it without a read, when the store is created.
- `loading`, `error` and `resolveStatus` (`"idle" | "pending" | "resolved" | "error"`) describe one resolve state. `loading` is `true` from the read that starts the load until the run lands; `resolveStatus` is still `"idle"` during that first render and becomes `"pending"` when the run starts. A failed run leaves the items untouched and `error` set until the next run starts. Branch on `resolveStatus`: `error` holds whatever the resolver threw, so it is `null` after a rejection with no value.
- Where `window` is not defined (a server render, a Node script or test) no resolver starts until `store.start()`, and `loading` reads `true` meanwhile. A store made with `usePalistor` starts nothing during a render in the browser either: the hook starts it once the component has committed, and until then an eager list also reads `loading: true` with `resolveStatus: "idle"`. To have the rows in server-rendered HTML (Next.js App Router), read the `palistor-ssr` skill.
- `onError` is the notification channel (a toast through `useNotifier`); `list.error` is the state to render. Use both. Next to `notify`, `onError` gets `t`, the store's translator, for the message; the declared type lacks it, so read it through the cast shown in [list API](references/list-api.md).
- `map` passes `(row, index, id)`. Use `id` as the React key.
- A row field is a field proxy like `form.email`: spread it into the adapter from the `palistor` skill (`<Input {...u.name} />`) or bind it by hand as above.
- Callbacks inside `defineList<TEntity>` (template rules, `resolver`, `onError`) take their parameter types from `TEntity`. A `filter` block and a separate edit template do not: annotate their callback parameters, or a `strict` project fails with TS7006.

Source for the `usePalistor` and `onError` rules: `cube/ssr/usePalistor.test.tsx` ("the render starts nothing and reads what a server render reads; the effect starts everything once"), `cube/core/resolve.test.ts` ("onError gets the store's translator").

## Core Patterns

### Re-fetch on a value change, retry on demand

- The resolver re-runs as soon as a form value or `store.context` key it read changes, including reads after an `await`. An unrelated field does not re-run it.
- Add `resolve.deps: ["path"]` only for a value the resolver does not read itself.
- `list.reload()` forces a new run, also after a success. It never starts a second run while one is pending, and its identity is stable, so it can be passed as a handler.
- A list resolve has no `retry` option and no `optimisticResolver`: retry with `reload()`.

### Add, remove and confirm rows

```tsx
import { defineList, Palistor, useForm } from "palistor";

interface Task { id: string; title: string; done: boolean }
declare function createTask(task: { title: string }): Promise<Task>;

const tasks = defineList<Task>({
  template: { id: { value: "" }, title: { value: "" }, done: { value: false } },
});
export const store = new Palistor({ config: { tasks } });

export function TaskToolbar() {
  const form = useForm(store);
  const list = form.tasks;

  async function addTask(title: string) {
    // The same format add() generates when `id` is omitted.
    const tempId = `_tmp_${crypto.randomUUID()}`;
    list.add({ id: tempId, title, done: false }); // visible at once, list.dirty === true
    try {
      const saved = await createTask({ title });
      store.rekey(tempId, saved.id); // the same row under the server id, in every list and open form
      // Optional: merge server-computed fields. It overwrites edits made while the request was pending.
      store.set({ ...saved }); // spread: an interface-typed object is not accepted as is
    } catch {
      store.delete(tempId); // roll back: the row leaves the registry and every list
    }
  }

  return (
    <>
      <button onClick={() => addTask("New task")}>Add</button>
      <button onClick={() => list.setItems([])}>Clear</button>
      {list.dirty && <span>Unsaved changes</span>}
    </>
  );
}
```

- `list.add(values)` upserts the row and returns it; `list.add(id)` appends a row that is already in the registry (a root list ignores an unknown id).
- `list.remove(id)` takes the row out of this list only; the entity stays in the registry and in other lists. `store.delete(id)` removes the entity everywhere.
- `list.setItems(ids)` replaces the membership. `list.getValues()` returns plain rows for logging or a request body.
- `store.set(row | rows)` creates or merges rows without touching any list.
- `list.dirty` means the membership differs from the last loaded one, or a row of the list owns a nested list that is dirty the same way; a row's field values take no part. After `rekey` a plain list stays dirty until the next resolve (`reload()`); a paginated list accepts the confirmed row as server truth and is clean. Source: `cube/contract/sliceC/entityListDirty.test.ts` ("per-entity list dirty reaches the parent list and the form"), `cube/core/listDirty.test.tsx` ("a row's field values still take no part: the list is dirty by composition only").

### Edit rows in place

Each row is an entity proxy (`useForm(user)` in `UserRow` above): `id`, one field proxy per template key, `values`, `dirty`, `loading`, `submitting`, `submit()`, `reset()`.

- A row field validates live through its `validate` rule: `isInvalid` and `errorMessage` update on every write, without a submit.
- `isRequired` on a template field is exposed as a prop but is not enforced. Write the rule in `validate`.
- `row.submit()` runs the row's `validate` rules, then the `onSubmit` of the template the row is shown through (declare it on a separate edit template, next pattern). `row.reset()` restores the row's fields to their baseline.
- The form's own `store.submit()` sends lists as plain rows and does not validate them. `store.reset()` leaves a root list's membership and rows alone, returns the lists nested in rows to their loaded rows and requests nothing: a nested list or a row field that has loaded stays `resolved`, and its next read does not call the resolver. Details are in [list API](references/list-api.md), "Lists nested inside a row". Source: `cube/contract/sliceC/entityListResolve.test.ts` ("per-entity list resolve and store.reset()"), `cube/contract/sliceC/entityFieldResolve.test.tsx` ("store.reset() runs nothing by itself; the next read re-runs on store, keeps the loaded result on Cube").

### Edit one entity through a separate form

Use a second template when the edit form needs other fields, rules, a loader or a submit. Any group of the config can be that template; bind it with the two-argument `useForm`.

```tsx
import { defineList, Palistor, useForm } from "palistor";
import type { PalistorEntityProxy, PalistorRef } from "palistor";

interface User { id: string; name: string }
interface UserDetails extends User { email: string }
declare function fetchUserDetails(id: string): Promise<{ email: string }>;
declare function saveUser(user: Record<string, unknown>): Promise<void>;

const users = defineList<User>({ template: { id: { value: "" }, name: { value: "" } } });

const editUserForm = {
  id: { value: "" },
  name: { value: "", validate: (v: string) => (v.trim() ? undefined : "Name is required") },
  email: { value: "", validate: (v: string) => (v.includes("@") ? undefined : "Invalid email") },
  resolve: {
    // Once per (entity, template), on mount. Receives the entity proxy; the result is merged into the row.
    resolver: async (entity: PalistorEntityProxy<User>) => fetchUserDetails(entity.id),
    onError: (error: unknown, ctx: { notify: (message: string) => void }) => ctx.notify("Could not load the user"),
  },
  // Receives the entity proxy, not plain values.
  onSubmit: async (entity: PalistorEntityProxy<UserDetails>) => saveUser(entity.values),
};

export const store = new Palistor({ config: { users, editUserForm } });

export function EditUser({ user }: { user: PalistorRef<User> }) {
  // The two-argument form returns `any`: annotate it.
  const form: PalistorEntityProxy<UserDetails> = useForm(user, (s) => s.editUserForm);
  if (form.loading) return <p>Loading…</p>;
  return (
    <form onSubmit={async (e) => { e.preventDefault(); await form.submit(); }}>
      <input value={form.name.value} onChange={(e) => form.name.onValueChange(e.target.value)} />
      <input value={form.email.value} onChange={(e) => form.email.onValueChange(e.target.value)} />
      {form.email.isInvalid && <em>{form.email.errorMessage}</em>}
      <button disabled={form.submitting}>Save</button>
    </form>
  );
}

export function UsersPage({ editingId }: { editingId: string | null }) {
  const form = useForm(store);
  const editing = editingId ? form.users.getById(editingId) : undefined;
  return editing ? <EditUser user={editing} /> : null;
}
```

Before adding per-field loaders, forcing the loader to run again, or handling the submit result, read [entity editing](references/entity-editing.md).

### Filter the rows

Declare a `filter` block on the list. A field with `where` filters the loaded rows in memory; any other field is sent to the resolver in `ctx.filter.params` and re-fetches the list when it changes.

```tsx
import { defineList, Palistor, useForm } from "palistor";

interface Car { id: string; name: string; isNew: boolean }
declare function fetchCars(params: unknown): Promise<Car[]>;

const cars = defineList<Car>({
  template: { id: { value: "" }, name: { value: "" }, isNew: { value: false } },
  filter: {
    search: { value: "", debounce: 300 }, // server field: one request 300 ms after the last keystroke
    onlyNew: { value: false, where: (car: Car, on: boolean) => car.isNew === on }, // client field: no request
  },
  resolve: { resolver: async (values, store, ctx) => fetchCars(ctx.filter.params) },
});
export const store = new Palistor({ config: { cars } });

export function CarFilters() {
  const filter = useForm(store).cars.filter!; // typed optional: present because the block is declared
  return (
    <>
      <input value={filter.search.value} onChange={(e) => filter.search.onValueChange(e.target.value)} />
      <input type="checkbox" checked={filter.onlyNew.value} onChange={(e) => filter.onlyNew.onValueChange(e.target.checked)} />
      {filter.isActive && <button onClick={() => filter.clear()}>Clear ({filter.activeCount})</button>}
    </>
  );
}
```

Before choosing between server and client fields, shaping request params, reading counts of a filtered list, or building a filter panel with Apply and Cancel buttons (`$apply: "manual"`), read [filtering](references/filtering.md).

### Sort the rows

Declare a `sort` block. `sort: true` makes every template field sortable; a header calls `sort.toggle(key)` (none → ascending → descending → back), and `items` / `map` follow the order.

```tsx
import type { ReactNode } from "react";
import { defineList, Palistor, useForm } from "palistor";
import type { PalistorList, SortProxyNode } from "palistor";

interface Product { id: string; title: string; price: number }
type ProductKey = keyof Product & string; // with nested groups: SortKey<Product>

const products = defineList<Product>({
  template: { id: { value: "" }, title: { value: "" }, price: { value: 0 } },
  sort: true, // a list without pagination sorts in the browser: no request
});
export const store = new Palistor({ config: { products } });

export function ProductsHead({ products }: { products: PalistorList<Product> }) {
  const sort = useForm(products).sort!; // typed optional: present because the block is declared
  return <tr><SortHeader sort={sort} column="title">Title</SortHeader><SortHeader sort={sort} column="price">Price</SortHeader></tr>;
}

function SortHeader({ sort, column, children }: { sort: SortProxyNode<ProductKey>; column: ProductKey; children: ReactNode }) {
  const s = useForm(sort); // re-renders on a sort change, not on a row edit
  const dir = s.dirOf(column);
  return <th aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}><button onClick={() => s.toggle(column)}>{children}</button></th>;
}
```

- In the browser the order is a snapshot: an edited row stays in place and an added row goes last until the next sort action, load or `sort.refresh()`.
- A paginated list (or one with `$server: true`) is sorted by its server: the resolver sends `ctx.sort.by`, and each sort change is one request for the first page.

Before adding a sort, choosing what sorts, paging a sorted list in memory, sorting a server-rendered or HeroUI table, or sorting on the server, read [sorting](references/sorting.md).

### Paginate the list

Add `resolve.pagination`. The resolver receives the page request in `ctx.page` and returns `{ items, total }`; every loaded page is cached, and a cached page is shown without a request.

```tsx
import { defineList, Palistor, useForm } from "palistor";
import type { PalistorRef } from "palistor";

interface Order { id: string; title: string }
declare function fetchOrders(q: { search: string; offset: number; limit: number }): Promise<{ rows: Order[]; count: number }>;

const orders = defineList<Order>({
  template: { id: { value: "" }, title: { value: "" } },
  resolve: {
    pagination: { pageSize: 20 }, // mode: "paged" (default) | "infinite" | "cursor"
    resolver: async (values, store, ctx) => {
      const page = ctx.page!; // typed optional: present because `pagination` is declared
      const r = await fetchOrders({ search: values.search, offset: page.offset, limit: page.pageSize });
      return { items: r.rows, total: r.count };
    },
  },
});
export const store = new Palistor({ config: { search: { value: "" }, orders } });

export function OrdersPager() {
  const list = useForm(store).orders;
  return (
    <>
      {list.isInitialLoading ? <p>Loading…</p> : <ul>{list.map((order, index, id) => <OrderRow key={id} order={order} />)}</ul>}
      <button disabled={!list.hasPrevPage} onClick={list.prevPage}>Prev</button>
      <span>Page {list.page} of {list.pageCount}</span>
      <button disabled={!list.hasNextPage} onClick={list.nextPage}>Next</button>
    </>
  );
}

function OrderRow({ order }: { order: PalistorRef<Order> }) {
  return <li>{useForm(order).title.value}</li>;
}
```

Before picking a mode, adding load-more or cursor paging, refreshing pages, or editing rows of a paginated list, read [pagination](references/pagination.md).

## Common Mistakes

### HIGH — Treating a failed or not-yet-started list as empty

Wrong:

```text
if (!list.loading && list.length === 0) return <Empty />;
```

Correct: branch on `list.resolveStatus` as in Setup — `"error"` → the error state, anything but `"resolved"` → loading, and the empty state only when resolved with `length === 0`. Read `list.length` (or `items` / `map` / `loading`) before the first early return: `resolveStatus` and `error` do not start the load, so a component that returns "Loading…" on `idle` without one of those reads never starts it.

Why: a failed resolve leaves `loading === false` with the items untouched, so this check shows the empty state after an error. A check of `length` alone shows it before the load as well: the rows are empty on the first render and in server-rendered HTML. `loading` covers that first render (it is `true` from the read that starts the load), but only `resolveStatus` tells loading, failed and empty apart. `onError` alone does not help: it notifies, it is not render state. Source: `cube/contract/sliceC/listResolveError.test.ts`, `cube/contract/sliceC/listResolve.test.ts` (`loading` before the first run), `cube/core/resolve.ts` (`touch`, `due`).

### HIGH — One-argument `useForm(row)` with a row from `getById`, `add` or `for…of`

Wrong:

```text
const row = form.users.getById(id);      // also: form.users.add({...}), [...form.users][0]
<UserRow user={row} />                   // UserRow calls useForm(user) → throws
```

Correct: take rows for `useForm(row)` from `list.map(...)` or `list.items[i]` (`list.items.find(...)` works). Rows from `getById` / `add` / iteration go to the two-argument form, `useForm(row, (s) => s.editUserForm)`.

Why: only `map`, `items` and `values` hand out rows bound to the calling component's tracking scope. The others return the raw node, and one-argument `useForm` rejects raw nodes with `useForm: received a raw store proxy node`. Source: `cube/react/useForm.ts` (`wrap`, `resolveInput`, `resolveEntity`).

### HIGH — Reading row fields in a child component without `useForm(row)`

Wrong: `function UserRow({ user }) { return <li>{user.name.value}</li>; }`

Correct: `const u = useForm(user);` first, then read `u.name.value`.

Why: the row passed as a prop is bound to the parent's subscription. Without its own `useForm` the child's reads are recorded on the parent, so every keystroke re-renders the whole list, and a memoized child does not update at all. Source: `cube/react/useForm.ts` (`wrap`, `track`), `cube/contract/sliceC/useFormEntity.test.tsx`.

### HIGH — Expecting `isRequired` to validate a row

Wrong: `name: { value: "", isRequired: true }` in a list template, relying on it to block `row.submit()`.

Correct: `name: { value: "", validate: (v) => (v.trim() ? undefined : "Name is required") }`.

Why: a row field's `isInvalid` / `errorMessage` and `row.submit()` use the `validate` rule only. With `isRequired: true` and an empty value, `isInvalid` is `false` and `row.submit()` succeeds. Source: `cube/core/cube.ts` (`rowError`, `submitEntity`), `cube/contract/sliceC/entityTemplateResolve.test.tsx`.

### HIGH — Confusing `list.remove(id)` with `store.delete(id)`

Wrong: `list.remove(id)` to delete a record, or `store.delete(id)` to hide a row from one list.

Correct: `list.remove(id)` changes this list's membership only. `store.delete(id)` removes the entity from the registry, from every list that shows it, and with the rows of its nested lists.

Why: membership and row data are separate. After `remove` the row is still in the registry (and still in other lists); after `delete` every list drops it and becomes dirty. Source: `cube/contract/sliceC/deleteListConsistency.test.ts`, `cube/core/hub.ts` (`deleteEntity`).

### HIGH — Expecting a re-read or re-mount to refetch

Wrong: remounting the component or reading `list.items` again to refresh after a success or an error.

Correct: `list.reload()` (on a paginated list also `list.refetch()`).

Why: reads start the resolve only from `idle`. After `resolved` or `error` nothing re-runs until a dependency changes or `reload()` is called. Source: `cube/contract/sliceC/listResolveError.test.ts`.

### MEDIUM — Template or rows without `id`

Wrong:

```ts expect-error=TS2741
import { defineList } from "palistor";

interface User { id: string; name: string }
export const users = defineList<User>({ template: { name: { value: "" } } });
```

Correct: declare `id: { value: "" }` in the template and return an `id` with every row.

Why: `id` is the registry key. A row without one gets a fresh `_tmp_…` id on every `add` or resolve, so its identity, edits and React key are lost on reload. Source: `cube/core/registry.ts` (`idOf`).

### MEDIUM — Declaring a list as a raw array

Wrong:

```ts expect-error=TS2339
import { Palistor } from "palistor";

const store = new Palistor({ config: { items: [{ id: { value: "" }, name: { value: "" } }] } });
store.proxy.items.add({ id: "a", name: "A" });
```

Correct: `items: defineList<Item>({ template: { … } })`.

Why: the runtime node is `[template, listConfig?]`, but TypeScript infers a plain array for the literal and types it as a group, so the list API is missing. `defineList` returns the branded node the types understand. Source: `store/store/types.ts` (`ConfigNodeToProxy`), `store/defineList.ts`.

### MEDIUM — Index or row object as the React key

Wrong: `list.items.map((row, i) => <Row key={i} user={row} />)`

Correct: `list.map((row, index, id) => <Row key={id} user={row} />)`

Why: membership changes shift indexes, so local component state lands on another row. The third argument is the entity id. Source: `cube/core/node.ts` (`listNode`).

### MEDIUM — Looking up the row you just added

Wrong: `list.add(values)` followed by a search through `list.items` for the new row.

Correct: `const row = list.add(values)` and hand `row` to the edit form (two-argument `useForm`).

Why: `add(values)` returns the created row; `add(id)` returns `undefined`. Source: `cube/contract/sliceC/listAddReturn.test.ts`.

### MEDIUM — Reaching into store internals for list state

Wrong: `store.resolveManager`, `store.entityRegistry`, `store.subscribe(...)` to detect loading or an error.

Correct: `list.loading`, `list.error`, `list.resolveStatus`, `list.reload()` read through `useForm`.

Why: the internals are not public API and differ between releases; the list properties are reactive and re-render the component when they change. Source: `cube/contract/sliceC/listResolveError.react.test.tsx`.

Mistakes specific to entity templates, filters and pagination are listed in the matching reference.

## Completion

1. Run `npx tsc --noEmit` in the project. A list API reported as missing means the list was declared as a raw array; a missing `id` means the template is incomplete; an error on `list.filter`, `list.sort` or on a pagination member means the optional typing was not handled (`list.filter!`, `list.sort!`, `list.setPage?.(2)`); TS7006 means a `where` or edit-template callback lacks parameter types.
2. Load the screen with a working API: the first paint shows the loading state, never the empty state, and the rows appear after the resolver settles.
3. Make the resolver fail once: the error state appears, the retry control calls `list.reload()`, and the rows appear after a successful run.
4. Add and remove a row: it appears and disappears without a request, `list.dirty` follows, and after `store.rekey` the row keeps its place under the new id.
5. Edit a row: only that row re-renders. If the whole list re-renders, a row component is missing its own `useForm(row)`.
6. Sorting: a header click orders every row, not only the page on screen (a client sort requests nothing; a server sort sends one request). With an Apply panel: typing requests nothing, Apply sends one request.

If a check fails, find the symptom in Common Mistakes before changing the config.

## References

- Read [list API](references/list-api.md) when you need the full member list of a list, a row or a row field, the store's entity methods, the typing helpers, or lists nested inside a row (how they get their rows, `dirty`, reset).
- Read [entity editing](references/entity-editing.md) when a row needs a separate edit form, per-row or per-field loading, or its own submit.
- Read [filtering](references/filtering.md) when the list needs search or filter controls, including a panel applied with a button.
- Read [sorting](references/sorting.md) when the rows are sorted by a column, in the browser or by the server.
- Read [pagination](references/pagination.md) when the list is loaded page by page, with load-more, or by cursor.
- Read the `palistor-ssr` skill when the list must be rendered on the server (Next.js App Router): rows a Server Component already fetched, no request from the store on the server, no second request after hydration.
