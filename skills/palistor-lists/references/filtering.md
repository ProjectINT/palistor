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
| `$all: (row, filterValues) => boolean` | Block option | Extra in-memory rule over all filter values; always runs |
| `$toParams: (filterValues, context) => unknown` | Block option | Builds `ctx.filter.params` yourself |

A field object accepts the usual leaf options too (`label`, `placeholder`, `formatter`, `isVisible`, …). Its computed options receive the filter's own values.

The block is typed loosely, so its callbacks get no parameter types from `TEntity`: annotate `where`, `$all`, `$toParams` and derived `value` parameters yourself.

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
| `filter.values` | Plain snapshot of all filter values, derived fields included. |
| `filter.set(patch)` | Write several fields at once: one notification, one request, no debounce. |
| `filter.reset()` | Back to the declared defaults. |
| `filter.clear(field?)` | Empty one field or all of them: `""`, `[]`, `false` or `null`, by the type of the default. |
| `filter.isActive` | Some non-derived field is non-empty. |
| `filter.activeCount` | How many such fields. |
| `filter.isPending` | A debounced change is waiting to send its request. |

Empty means `""`, a blank string, `null`, `undefined`, `NaN`, `false` or `[]`. A `where` is skipped while its field is empty, so an unchecked toggle or a cleared select shows every row.

Assigning to `filter.search` throws. Write `filter.search.value = …`, call `filter.search.onValueChange(…)` or use `filter.set({ … })`.

## What the list shows

| Member | Under a client filter |
| --- | --- |
| `items`, `map`, `length`, iteration, `values` | The visible rows |
| `fullLength` | All loaded rows |
| `getById`, `getValues()`, `dirty`, the list inside `store.getValues()` and the submit payload | All loaded rows |

- `values` and `fullLength` exist only on a list with a `filter` block.
- Client rules are ANDed; `$all` runs last.
- The visible set follows row edits: a row that stops matching disappears as soon as it is edited.
- A row added locally (`list.add`) stays visible whatever the client rules say, until the next resolve.

## Requests

- The first resolve is never debounced. After it, each change of a server field causes one resolver run.
- `debounce` delays the request, not the input: `filter.search.value` updates at once and `isPending` is `true` until the request is sent. Typing and reverting within the delay sends nothing.
- A change of a field without `debounce`, and `set` / `reset` / `clear`, send at once and carry the current values of debounced fields: one request per list.
- A client field never causes a request. A block with only `where` fields works on a list without a resolver.
- On a paginated list a server field change starts a new query at the first page, see [pagination](pagination.md).
- The resolver's third argument always has `ctx.filter`: `{ values, params, key }`. `values` holds every filter value, `params` the server fields under their `param` names (or the result of `$toParams`), `key` identifies the request. Without a filter block `values` is `{}` and `params` is `undefined`.

## Constraints

These throw when the store is created:

- `where` together with `param` or `debounce` on one field (a client field never sends a request).
- `param` or `debounce` on a derived field.
- A field named `values`, `set`, `reset`, `clear`, `isActive`, `activeCount` or `isPending`.
- An unknown `$` key. Field names must not start with `$`.

Other limits:

- A `filter` block on a list nested inside a row is ignored with a console warning.
- Filter values are not persisted by `usePersist`. `$persist` is accepted and has no effect.
- With `fieldMapping`, filter field configs are written and read in the mapped names, like form fields. A mapping that renames a prop to a list key such as `values` or `filter` throws when the store is created.

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
