# Filtering a list

A `filter` block on `defineList` holds the filter controls of one list. The controls are field proxies you bind like form fields; the list shows the rows that pass. The block is view state: it is not part of the form's values.

## Field kinds

| Declaration | Kind | Effect of a change |
| --- | --- | --- |
| `search: ""` | Server field, literal default | The resolver runs again and reads it from `ctx.filter` |
| `search: { value: "", debounce: 300 }` | Server field | The same, 300 ms after the last change |
| `brand: { value: null, param: "brand_id" }` | Server field | The same; the request param is named `brand_id` |
| `onlyNew: { value: false, where: (row, value) => … }` | Client field | No request: rows are filtered in memory |
| `summary: { value: (filterValues) => … }` | Derived field | Read-only; not sent, not counted |
| `role: { value: "", apply: "manual" }` | Manual field (server or client) | Nothing until `filter.apply()`: the value is a draft (manual mode, below) |
| `$all: (row, filterValues) => boolean` | Block option | Extra in-memory rule over all filter values, run after the `where` rules. It runs only in a block that has a client field: give a field that only `$all` reads `where: () => true` |
| `$toParams: (filterValues, context) => unknown` | Block option | Builds `ctx.filter.params` yourself |
| `$apply: "manual"` | Block option | Every non-derived field of the block is a manual field, unless it declares `apply: "auto"` |

A field object accepts the usual leaf options too (`label`, `placeholder`, `formatter`, `isVisible`, …). Its computed options receive the filter's own values.

The block is typed loosely: `where` and a derived `value` get no parameter types, so annotate their parameters yourself or a `strict` project fails with TS7006. `$all` and `$toParams` are typed (`row: TEntity`, `filterValues: Record<string, unknown>`): leave their parameters unannotated or use `Record<string, unknown>`, because a narrower interface for the filter values fails with TS2322.

## Example

```tsx
import { defineList, Palistor, useForm } from "palistor";
import type { PalistorRef } from "palistor";

interface Car { id: string; name: string; brand: string; isNew: boolean; price: number }
interface CarParams { search: string; brand_id: string | null }
declare function fetchCars(params: CarParams): Promise<Car[]>;

const cars = defineList<Car>({
  template: {
    id: { value: "" }, name: { value: "" }, brand: { value: "" }, isNew: { value: false }, price: { value: 0 },
  },
  filter: {
    search: { value: "", debounce: 300, placeholder: "Search" },
    brand: { value: null as string | null, param: "brand_id" },
    onlyNew: { value: false, where: (car: Car, on: boolean) => car.isNew === on },
    maxPrice: { value: null as number | null, where: (car: Car, max: number) => car.price <= max },
  },
  resolve: {
    // Server fields arrive in ctx.filter.params under their param names. They are not in `values`.
    resolver: async (values, store, ctx) => fetchCars(ctx.filter.params as CarParams),
  },
});

export const store = new Palistor({ config: { cars } });

export function CarsScreen() {
  const list = useForm(store).cars;
  const filter = list.filter!; // typed optional; present because the block is declared

  return (
    <>
      <input
        placeholder={filter.search.placeholder}
        value={filter.search.value}
        onChange={(e) => filter.search.onValueChange(e.target.value)}
      />
      <label>
        <input type="checkbox" checked={filter.onlyNew.value} onChange={(e) => filter.onlyNew.onValueChange(e.target.checked)} />
        New only
      </label>
      <button onClick={() => filter.set({ brand: "bmw", maxPrice: 50000 })}>BMW under 50k</button>
      {filter.isActive && <button onClick={() => filter.clear()}>Clear filters ({filter.activeCount})</button>}
      {filter.isPending && <span>…</span>}

      <p>Showing {list.length} of {list.fullLength}</p>
      <ul>{list.map((car, index, id) => <CarRow key={id} car={car} />)}</ul>
    </>
  );
}

function CarRow({ car }: { car: PalistorRef<Car> }) {
  return <li>{useForm(car).name.value}</li>;
}
```

## `list.filter` members

| Member | Meaning |
| --- | --- |
| `filter.<field>` | A field proxy: `value`, `onValueChange`, `label`, … Spread it into an adapter like a form field. |
| `filter.values` | Plain snapshot of all filter values, derived fields included. In manual mode: the drafts. |
| `filter.set(patch)` | Write several fields at once: one notification, no debounce, and one request when an automatic server field changed. A manual field takes the value as its draft and requests nothing. |
| `filter.reset()` | Back to the declared defaults (as drafts for manual fields). |
| `filter.clear(field?)` | Empty one field or all of them: `""`, `[]`, `false` or `null`, by the type of the default (as drafts for manual fields). |
| `filter.isActive` | Some non-derived field is non-empty (by its applied value in manual mode). |
| `filter.activeCount` | How many such fields. |
| `filter.isPending` | A debounced change is waiting to send its request. |
| `filter.apply()` | Manual mode: the drafts become the applied values. A no-op in automatic mode. |
| `filter.revert()` | Manual mode: the drafts go back to the applied values; no request. A no-op in automatic mode. |
| `filter.isDraft` | Manual mode: a draft differs from its applied value. Always `false` in automatic mode. |
| `filter.applied` | Snapshot of the values the list is filtered by: applied for a manual field, current otherwise. Equals `values` in automatic mode. |

Empty means `""`, a blank string, `null`, `undefined`, `NaN`, `false` or `[]`. A `where` is skipped while its field is empty, so an unchecked toggle or a cleared select shows every row.

Assigning to `filter.search` throws. Write `filter.search.value = …`, call `filter.search.onValueChange(…)` or use `filter.set({ … })`.

`apply`, `revert`, `isDraft` and `applied` are not enumerable: a spread of `list.filter` and `Object.keys` show the fields and the seven other members only.

## What the list shows

| Member | Under a client filter |
| --- | --- |
| `items`, `map`, `length`, iteration, `values` | The visible rows |
| `fullLength` | All loaded rows |
| `getById`, `getValues()`, `dirty`, the list inside `store.getValues()` and the submit payload | All loaded rows |

- `values` and `fullLength` exist only on a list with a `filter` block.
- Client rules are ANDed; `$all` runs last, on every projection. A block has a projection only when some field declares `where`: without one, `$all` never runs. A field read only by `$all` therefore needs `where: () => true`, or it is a server field.
- The visible set follows row edits: a row that stops matching disappears as soon as it is edited.
- A row added locally (`list.add`) stays visible whatever the client rules say, until the next resolve.

Source for `$all`: `cube/core/filter.ts` (constructor: `hasClient`), `cube/core/listCube.ts` (`visibleIds`), `cube/contract/sliceE/filtering.test.ts` (E3, with the `exclude: { value: null, where: () => true }` field).

## Requests

- The first resolve is never debounced. After it, each change of a server field causes one resolver run.
- `debounce` delays the request, not the input: `filter.search.value` updates at once and `isPending` is `true` until the request is sent. Typing and reverting within the delay sends nothing.
- A change of a field without `debounce`, and `set` / `reset` / `clear`, send at once and carry the current values of debounced fields: one request per list.
- A client field never causes a request. A block with only `where` fields works on a list without a resolver.
- On a paginated list a server field change starts a new query at the first page, see [pagination](pagination.md).
- The resolver's third argument always has `ctx.filter`: `{ values, params, key }`. `values` holds every filter value, `params` the server fields under their `param` names (or the result of `$toParams`), `key` identifies the request. Without a filter block `values` is `{}` and `params` is `undefined`. In manual mode all three are built from the applied values.
- The request identity (`ctx.filter.key`, and the page key of a paginated list) is built from the server fields' values, not from what `$toParams` returns. Two values that `$toParams` maps to the same params (`"a"` and `"a "` trimmed) are two requests. Normalize the value in the field (a `formatter`) when that matters. Source: `cube/core/filter.ts` (`serverKey`, `issue`); authoring probe (three resolver runs for `""`, `"a"`, `"a "` under a trimming `$toParams`).

## Apply with a button (manual mode)

`$apply: "manual"` turns the block's fields into a draft: typing changes the inputs and nothing else, and `filter.apply()` (an "Apply" button, Enter in a search box) hands the drafts to the list. It replaces the hand-written pair of a `search` field, an `appliedSearch` field and a submit between them.

```tsx
import { defineList, Palistor, useForm } from "palistor";
import type { FieldProxyNode, FilterProxyNode, PalistorList, PalistorRef } from "palistor";

interface Customer { id: string; name: string; role: string }
interface CustomerParams { search: string; role: string; quick: string }
declare function fetchCustomers(q: CustomerParams & { offset: number; limit: number }): Promise<{ rows: Customer[]; total: number }>;

const customers = defineList<Customer>({
  template: { id: { value: "" }, name: { value: "" }, role: { value: "" } },
  filter: {
    $apply: "manual", // the fields are a draft until filter.apply()
    search: "",
    role: "",
    quick: { value: "", apply: "auto", debounce: 300 }, // the exception: applied as it changes
  },
  resolve: {
    pagination: { pageSize: 20 },
    resolver: async (values, store, ctx) => {
      const page = ctx.page!;
      const params = ctx.filter.params as CustomerParams; // the applied values
      const r = await fetchCustomers({ ...params, offset: page.offset, limit: page.pageSize });
      return { items: r.rows, total: r.total };
    },
  },
});
export const store = new Palistor({ config: { customers } });

export function CustomersScreen() {
  const list = useForm(store).customers;
  return <><FilterPanel filter={list.filter!} /><CustomerList customers={list} /></>;
}

function FilterPanel({ filter }: { filter: FilterProxyNode }) {
  const f = useForm(filter); // re-renders on a keystroke here, on isDraft and on what is applied
  return (
    // A submit button: Enter in the search box applies too.
    <form onSubmit={(e) => { e.preventDefault(); f.apply(); }}>
      <TextField label="Search" field={f.search} />
      <select aria-label="Role" value={f.role.value} onChange={(e) => f.role.onValueChange(e.target.value)}>
        <option value="">Any role</option>
        <option value="admin">Admin</option>
        <option value="editor">Editor</option>
      </select>
      <button type="submit" disabled={!f.isDraft}>Apply</button>
      <button type="button" disabled={!f.isDraft} onClick={() => f.revert()}>Cancel</button>
      {f.isActive && <span>Filters: {f.activeCount}</span>} {/* counts the applied values */}
    </form>
  );
}

function TextField({ label, field }: { label: string; field: FieldProxyNode<string> }) {
  const f = useForm(field); // shows the draft
  return <input aria-label={label} value={f.value} onChange={(e) => f.onValueChange(e.target.value)} />;
}

function CustomerList({ customers }: { customers: PalistorList<Customer> }) {
  const list = useForm(customers); // a draft keystroke does not re-render it
  return <ul>{list.map((row, index, id) => <CustomerItem key={id} customer={row} />)}</ul>;
}

function CustomerItem({ customer }: { customer: PalistorRef<Customer> }) {
  return <li>{useForm(customer).name.value}</li>;
}
```

- The draft is what `filter.<field>.value`, its input and `filter.values` show. Everything that acts on the list reads the applied value: the client projection (`where`, `$all`), `ctx.filter.values`, `params` and `key`, `$toParams`, the page key, `isActive`, `activeCount` and `filter.applied`.
- Typing in a manual field sends nothing, leaves the rows as they are and does not re-render a component that reads only the rows.
- `apply()` is one notification and at most one request: none when every draft equals its applied value, and none when only client (`where`) fields moved — the loaded rows are filtered again. When the request changes, a paginated list goes back to its first page. A debounced change of an automatic field that is still pending goes into the same request, and its debounce stops; an `apply()` with no draft to apply does nothing, and that debounce runs on.
- `revert()` writes the applied values back into the fields (no `formatter`, no `onChange`) and sends nothing.
- `isDraft` compares like `dirty`: `null` equals `undefined`; arrays and objects compare by their JSON text, so key order counts.
- `set`, `reset` and `clear` write the manual fields as drafts; a field with `apply: "auto"` changes at once and sends its own request. A chip's ✕ on a manual field is `clear("role")` then `apply()`: one request. A "Clear all" is `clear()` then `apply()`, which is two requests when the block has a non-empty automatic server field (`quick` above): `clear()` sends the first one at once, with the old applied values of the manual fields. To clear only the manual fields in one request, call `filter.set({ search: "", role: "" })` then `apply()`.
- A field with `apply: "auto"` in a manual block keeps its own `debounce` and sends its request by itself; that request carries the applied values of the manual fields, not their drafts. `apply: "manual"` on one field makes only that field manual in an automatic block.
- A derived field's `value` is computed from the drafts; `filter.applied` and the list compute it from the applied values.
- With `initialData`, typing in a manual field requests nothing. The first request comes from an `apply()` that changes a server field's applied value, or from an automatic field's own change.
- `useForm(props.filter)` type-checks: a filter panel gets `list.filter!` as a `FilterProxyNode` prop, like a field. Its fields come through an index signature typed `any`, so `f.role.value` is not checked: give a child input a typed prop (`FieldProxyNode<string>`, as `TextField` above).
- A block built in a separate variable needs `as const`: otherwise `$apply` widens to `string` and `defineList` rejects the block (TS2322).

Source: `cube/core/filter.ts` (`effective`, `apply`, `revert`, `isDraft`, `check`), `cube/core/filterApply.test.ts`, `cube/react/filterApply.react.test.tsx` ("the plan's filter panel", "apply mode + useForm precision"), `cube/types.ts` (`UseForm`), `store/store/types.ts` (`FilterBlock.$apply`, `FilterFieldConfig.apply`, `FilterProxyNode`), `cube/core/config.ts` (`isDirtyValue`); `as const`: authoring type check; `clear()` + `apply()` next to a non-empty automatic field (two resolver runs) and the `initialData` cases: release-audit probe.

## Constraints

These throw when the store is created:

- `where` together with `param` or `debounce` on one field (a client field never sends a request).
- `param`, `debounce` or `apply` on a derived field.
- `debounce` on a manual field (its typing sends nothing), and a `$apply: "manual"` that reaches no field (every field derived or `apply: "auto"`).
- A `$apply` or `apply` other than `"manual"` or `"auto"`.
- A field named `values`, `set`, `reset`, `clear`, `isActive`, `activeCount`, `isPending`, `apply`, `revert`, `isDraft` or `applied`.
- An unknown `$` key. Field names must not start with `$`.

Other limits:

- A `filter` block on a list nested inside a row is ignored with a console warning.
- Filter values are not persisted by `usePersist`. `$persist` is accepted and has no effect.
- With `fieldMapping`, filter field configs are written and read in the mapped names, like form fields. A mapping that renames a prop to a list key such as `values` or `filter` throws when the store is created.

Source for the manual-mode rules: `cube/core/filter.ts` (`normalize`, `FILTER_BUILTINS`), `cube/core/filterApply.test.ts` ("dead or invalid apply config throws at construction").

## Common mistakes

### HIGH — Reading a server filter through `values` or `deps`

Wrong: `resolver: async (values) => fetchCars({ search: values.search })` with `search` declared in the `filter` block.

Correct: `resolver: async (values, store, ctx) => fetchCars(ctx.filter.params as CarParams)`.

Why: the block lives outside the form. `values.search` is `undefined`, and `deps: ["search"]` matches nothing; the filter reaches the resolver only through `ctx.filter`, and its server fields re-run the resolver by themselves. Source: `cube/contract/sliceE/filterSurface.test.tsx` ("the resolver's values and getValues() never contain the filter").

### HIGH — `where` with `param` or `debounce`

Wrong:

```text
search: { value: "", debounce: 300, where: (row, value) => row.name.includes(value) }
```

Correct: choose one kind. Server-side search: `{ value: "", debounce: 300 }` and read `ctx.filter.params.search`. In-memory search: `{ value: "", where: … }`.

Why: a `where` field never sends a request, so `param` and `debounce` could never apply; the store refuses to build. Source: `cube/contract/sliceE/filtering.test.ts` (A6).

### HIGH — An Apply button over automatic fields

Wrong: a filter panel with "Apply" and "Cancel" buttons over a block without `$apply` (with or without `debounce`), where Apply calls `list.reload()` or `filter.set(filter.values)` and Cancel calls `filter.reset()`.

Correct: `$apply: "manual"` on the block; Apply calls `filter.apply()`, Cancel calls `filter.revert()`, and `!filter.isDraft` disables both.

Why: an automatic server field sends a request after every change (after its debounce), so the rows change while the user is still choosing, and Apply sends one more request. Cancel with `reset()` goes back to the defaults, not to what was applied. Source: `cube/contract/sliceE/filtering.test.ts` (D2, D4), `cube/core/filterApply.test.ts` ("typing in a manual field", "apply()", "revert()").

### MEDIUM — A draft and an applied copy kept by hand

Wrong: a `search` field for the input and an `appliedSearch` field the resolver reads, with a submit that copies one into the other.

Correct: one manual field: `filter: { $apply: "manual", search: "" }` and `filter.apply()`.

Why: the hand-written pair needs its own "changed" flag, revert and active count, and its placement fails either way: next to `appliedSearch` in the filter block, `search` is a server field that requests on every keystroke; as a form field it joins `getValues()`, the submit payload and a persisted draft. Source: `cube/core/filter.ts` (constructor: a field without `where` is a server field), `cube/contract/sliceE/filtering.test.ts` (C1, D2).

### MEDIUM — Expecting `set`, `reset` or `clear` to change the rows in manual mode

Wrong: a "Clear all" button that calls `filter.clear()` on a manual block.

Correct: `filter.clear()` then `filter.apply()`.

Why: in manual mode the three write the manual fields as drafts; the rows, the request and `isActive` follow `apply()`. A field with `apply: "auto"` changes at once, so in a block that has one, see the "Clear all" rule above. Source: `cube/core/filterApply.test.ts` ("set() writes the drafts and requests nothing; apply() sends them", "clear() writes the drafts; clear() + apply() is one request").

### MEDIUM — A field that only `$all` reads

Wrong: `filter: { exclude: { value: null }, $all: (row: Car, f: Record<string, unknown>) => row.id !== f.exclude }`.

Correct: `exclude: { value: null, where: () => true }`.

Why: without a `where` field the block has no client projection, so `$all` never runs, and `exclude` is a server field: it is sent in `ctx.filter.params` and re-runs the resolver. Source: `cube/core/filter.ts` (`hasClient`), `cube/core/listCube.ts` (`visibleIds`), `cube/contract/sliceE/filtering.test.ts` (E3); authoring probe (without `where`: a second resolver run and no row hidden).

### MEDIUM — Filtering rows in the component

Wrong: `useState` for the search text and `list.items.filter(...)` in the render.

Correct: a `filter` block with `where` fields; render `list.map(...)`.

Why: hand-made filtering re-implements emptiness checks, loses `isActive` / `activeCount` / `fullLength`, and keeps view logic in the component instead of the config. Source: `cube/contract/sliceE/filteringExample.port.test.ts`.

### MEDIUM — Expecting `store.reset()` to clear the filters

Wrong: calling `store.reset()` or the form's `reset()` to reset the filter controls.

Correct: `list.filter.reset()` (defaults) or `list.filter.clear()` (empty).

Why: filter values are not form values: they are absent from `getValues()` and untouched by a form reset. `reset()` and `clear()` differ only when a default is non-empty: after `reset()` such a filter is active again. Source: `cube/contract/sliceE/filtering.test.ts` (C1, F3).

### MEDIUM — Using `list.length` as the number of loaded rows

Wrong: `list.length` for a "total" badge, or `list.items` to build a request body, while a client filter is active.

Correct: `list.fullLength` for the count, `list.getValues()` for all rows.

Why: under a client filter `length`, `items`, `map` and `values` describe the visible rows only. Source: `cube/contract/sliceE/filtering.test.ts` (C2, E2), `cube/core/listCube.ts`.
