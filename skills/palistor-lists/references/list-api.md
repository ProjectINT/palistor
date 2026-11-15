# List API reference

Members of a list, of a row and of a row field, the store's entity methods, the typing helpers, and lists nested inside a row. For filter and pagination members see [filtering](filtering.md) and [pagination](pagination.md).

## Declaring a list

```ts
import { defineList } from "palistor";

interface User { id: string; name: string }
declare function fetchUsers(tenant: unknown): Promise<User[]>;

export const users = defineList<User>({
  template: { id: { value: "" }, name: { value: "" } },
  resolve: {
    resolver: async (values, store, ctx) => fetchUsers(store.context.tenantId),
    onError: (error, { notify }) => notify("Could not load users"),
    deps: [], // paths of values the resolver does not read itself
    options: { lazy: true, suspense: false }, // the defaults
  },
});
```

| Key | Meaning |
| --- | --- |
| `template` | One leaf config per entity key. `id` is required. Leaf options are the same as for a form field (`validate`, `formatter`, `label`, `isVisible`, …). |
| `resolve.resolver(values, store, ctx)` | Returns the rows (each with `id`). `values` are the form values without the list's filter, `store.context` is the store context, `ctx` carries `ctx.filter` and, on a paginated list, `ctx.page`. |
| `resolve.onError(error, { notify })` | Called when the resolver throws. Optional on a list. |
| `resolve.deps` | Extra dependency paths. Values the resolver reads are tracked automatically. |
| `resolve.options.lazy` | `true` (default): start on the first read. `false`: start when the store is created. |
| `resolve.options.suspense` | `true`: `items`, `length`, `map` and `values` throw the pending promise for React `<Suspense>`. |
| `resolve.pagination` | Page cache, see [pagination](pagination.md). |
| `filter` | Filter block, see [filtering](filtering.md). Root lists only. |

Template rules:

- A computed `value` (a function) is not allowed in a template and throws when the store is created: a row's value comes from its data.
- A template key cannot be named `loading`, `submitting`, `submit`, `values` or `dirty`: the row proxy uses those names.
- The typed template of `defineList<TEntity>` accepts only the keys of `TEntity`. `onSubmit` and a template-level `resolve` belong on a separate edit template, see [entity editing](entity-editing.md).
- Callbacks inside `defineList<TEntity>` (template rules, `resolver`, `onError`) take their parameter types from `TEntity`, so they need no annotations.

## List members

Read through `useForm(store).users`, or through `store.proxy.users` outside React.

| Member | Type | Meaning |
| --- | --- | --- |
| `items` | `ReadonlyArray<row>` | The rows in order. Reading it starts a lazy resolve. |
| `length` | `number` | Number of rows shown. Starts a lazy resolve. |
| `map(fn)` | `(row, index, id) => R` | Render entry point. Starts a lazy resolve. |
| `[Symbol.iterator]` | | `for (const row of list)`. Rows from iteration work with the two-argument `useForm` only. |
| `loading` | `boolean` | The resolver is running. |
| `error` | `unknown \| null` | What the last run threw; `null` after a success, before any run and while a new run is pending. |
| `resolveStatus` | `"idle" \| "pending" \| "resolved" \| "error"` | Raw resolve status. Stays `"idle"` on a list without a resolver. |
| `reload()` | `void` | Run the resolver again. Stable identity; no-op without a resolver or while a run is pending. |
| `dirty` | `boolean` | The membership differs from the last loaded one. |
| `add(values)` | returns the row | Upsert the row and append it. A row without `id` gets a `_tmp_…` id. |
| `add(id)` | `void` | Append a row that is already in the registry. |
| `remove(id)` | `void` | Take the row out of this list. The entity stays in the registry. |
| `setItems(ids)` | `void` | Replace the membership with rows that are already in the registry. Duplicates collapse to the first occurrence. |
| `getById(id)` | row or `undefined` | Find a row of this list. The result works with the two-argument `useForm` only. |
| `getValues()` | `Array<Record<string, unknown>>` | Plain copy of all rows. |

`loading`, `error` and `resolveStatus` are never renamed by `fieldMapping`.

## Row (entity) members

A row from `map` or `items`, passed through `useForm(row)`, or the result of `useForm(row, selector)`.

| Member | Type | Meaning |
| --- | --- | --- |
| `id` | `string` | The entity id. Follows `store.rekey`. |
| one per template key | field proxy | See the next table. |
| `values` | `Record<string, unknown>` | Current values of the row, `id` included. Use it as a request body. |
| `dirty` | `boolean` | Any field of the row differs from its baseline. |
| `loading` | `boolean` | The template-level resolve of `useForm(row, selector)` is running; `false` otherwise. |
| `submitting` | `boolean` | `submit()` is running. |
| `submit()` | `Promise<SubmitResult>` | Validate the row, then run the template's `onSubmit`. |
| `reset()` | `void` | Restore the row's fields to their baseline. |

## Row field members

The same members as a form field (`value`, `onValueChange`, `label`, `placeholder`, `description`, `isRequired`, `isReadOnly`, `isDisabled`, `isVisible`, `isInvalid`, `errorMessage`, `dirty`), with these differences:

- `isInvalid` and `errorMessage` come from the field's `validate` rule and are live: no failed submit is needed to show them. `isInvalid` is `false`, not `undefined`, when there is no error. `isRequired` does not produce an error.
- `loading` is `true` while the field's own resolver runs (see [entity editing](entity-editing.md)). It exists at runtime but is missing from the `FieldProxyNode` type: widen it once, `const field = row.isOnline as typeof row.isOnline & { loading: boolean }`.
- A spread (`{...row.name}`) also carries `dirty`, `loading`, `submitting` and `submit`. An adapter that forwards the rest of its props to a DOM element must take these out.
- The baseline of `dirty` is the value the row was loaded or created with; a resolver result moves it.

## Store entity methods

```ts
import { defineList, Palistor } from "palistor";

interface User { id: string; name: string }

const users = defineList<User>({ template: { id: { value: "" }, name: { value: "" } } });
const store = new Palistor({ config: { users } });

store.set({ id: "u1", name: "Alice" }); // create or merge one row; no list changes
store.set([{ id: "u2", name: "Bob" }, { id: "u3", name: "Carol" }]); // batch, one notification
store.proxy.users.add("u1"); // show an existing row in a list
store.rekey("u1", "server-id"); // same row, new id, in every list and open form
store.delete("u2"); // remove the row everywhere, with the rows of its nested lists
store.invalidate("u3"); // forget that u3's edit templates were loaded
```

- `store.set` merges: keys missing from the patch are kept, nested objects are merged recursively.
- `store.set` takes an index-signature type. An object typed by an `interface` is rejected with TS2345: spread it, `store.set({ ...user })`.
- `store.rekey` and `store.delete` are no-ops for an unknown id.

## Lists and the rest of the form

- `store.getValues()` and the submit payload contain each list as an array of plain rows. Under a client filter they contain all rows, not the visible ones.
- `store.submit()` does not validate rows. Validate a row with `row.submit()` or read `isInvalid` on its fields.
- `store.setValues({ users: [...] })` ignores the list key. Change membership through the list.
- `store.reset()` keeps the membership and the rows of a root list. On a paginated list it rolls back local adds and removes.
- The form's `dirty` includes the list's `dirty`.

## Typing helpers

| Type | Use |
| --- | --- |
| `PalistorRef<TEntity>` | Prop type of one row: `{ user: PalistorRef<User> }`. Opaque until passed to `useForm`. |
| `PalistorList<TEntity>` | Prop type of a whole list: `{ users: PalistorList<User> }`; call `useForm(users)` in the child. |
| `PalistorEntityProxy<TEntity>` | Result type of `useForm(row)`. Annotate the result of the two-argument `useForm` with it, because that form returns `any`. |
| `InferEntity<T>` | The entity type of a `PalistorRef<T>`. |
| `ListResolver<TEntity>` | Type of a resolver declared outside `defineList`. |
| `TemplateConfig<TEntity>` | Type of a template declared outside `defineList`. |
| `ListResolveContext` | Type of the resolver's third argument. |
| `ListProxyNode<TItem>` | The list members above. |

```tsx
import { useForm } from "palistor";
import type { PalistorList, PalistorRef } from "palistor";

interface User { id: string; name: string }

export function UserList({ users }: { users: PalistorList<User> }) {
  const list = useForm(users); // a list received as a prop gets its own subscription
  return <ul>{list.map((user, index, id) => <UserName key={id} user={user} />)}</ul>;
}

function UserName({ user }: { user: PalistorRef<User> }) {
  return <li>{useForm(user).name.value}</li>;
}
```

## Lists nested inside a row

A `defineList` placed inside a template is a per-row list: every row gets its own instance with its own membership and resolve state.

```tsx
import { defineList, Palistor, useForm } from "palistor";
import type { PalistorEntityProxy, PalistorList, PalistorRef } from "palistor";

interface Contact { id: string; phone: string }
interface User { id: string; name: string }
declare function fetchContacts(userId: string): Promise<Contact[]>;

const contacts = defineList<Contact>({
  template: { id: { value: "" }, phone: { value: "" } },
  // The first argument is the owner row's values, not the form's.
  resolve: { resolver: async (owner) => fetchContacts(String(owner.id)) },
});

const users = defineList<User>({
  // The typed template does not accept a nested list yet (TS2559): cast the template.
  template: { id: { value: "" }, name: { value: "" }, contacts } as any,
});
export const store = new Palistor({ config: { users } });

export function UserContacts({ user }: { user: PalistorRef<User> }) {
  // The row type does not describe the nested list either: add it by hand.
  const row = useForm(user) as PalistorEntityProxy<User> & { contacts: PalistorList<Contact> };
  return <ul>{row.contacts.map((contact, index, id) => <li key={id}>{id}</li>)}</ul>;
}
```

- Rows added to a per-row list are owned by that row: `store.delete(ownerId)` deletes them too.
- `add(id)` with an id that is not in the registry throws on a per-row list (a root list ignores it).
- The row's `values` and `getValues()` contain the nested list once it has been loaded or changed.
- `resolve.pagination` works per row. A `filter` block on a per-row list is ignored with a console warning.
