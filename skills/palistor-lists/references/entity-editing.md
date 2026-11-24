# Entity editing

How to edit one row through a separate template, load extra data per row or per field, and submit a row.

## Pick the form of `useForm`

| Call | Use when | Result |
| --- | --- | --- |
| `useForm(row)` | The list template already has the fields and rules you need. `row` comes from `list.map` or `list.items`. | Typed `PalistorEntityProxy<TEntity>`. |
| `useForm(row, (s) => s.editForm)` | The edit form needs other fields, other rules, a loader or a submit. `row` may come from `map`, `items`, `getById`, `add` or iteration. | `any`: annotate it. |

The selector receives the store proxy and returns a group of the config. That group is the template: its leaves are the fields, its `resolve` is the loader, its `onSubmit` is the save. Both forms read and write the same row, so an edit in the form shows in the list at once.

`useForm(store, selector)` is not a valid call: the two-argument form is for rows only.

## Template anatomy

```tsx
import { defineList, Palistor, useForm } from "palistor";
import type { PalistorEntityProxy, PalistorRef } from "palistor";

interface User { id: string; name: string }
interface UserDetails extends User { email: string; bio: string }
type UserProxy = PalistorEntityProxy<UserDetails>;
type Notify = { notify: (message: string) => void };
declare function fetchUserDetails(id: string): Promise<{ email: string }>;
declare function fetchBio(id: string): Promise<string>;
declare function saveUser(user: Record<string, unknown>): Promise<{ updatedAt: string }>;

const users = defineList<User>({ template: { id: { value: "" }, name: { value: "" } } });

// A plain group: its callbacks have no contextual types, so annotate their parameters.
const editUserForm = {
  id: { value: "" },
  name: { value: "", validate: (value: string) => (value.trim() ? undefined : "Name is required") },
  email: { value: "", validate: (value: string) => (value.includes("@") ? undefined : "Invalid email") },
  bio: {
    value: "",
    // Field resolver: runs when a component first reads bio.value or bio.loading.
    resolve: {
      resolver: async (row: Record<string, unknown>) => fetchBio(String(row.id)),
      onError: (error: unknown, { notify }: Notify) => notify("Could not load the bio"),
    },
  },
  // Template resolve: once per (row, template) when the form mounts. The result is merged into the row.
  resolve: {
    resolver: async (entity: UserProxy) => fetchUserDetails(entity.id),
    onError: (error: unknown, { notify }: Notify) => notify("Could not load the user"),
  },
  // Runs after the validate rules pass. Receives the entity proxy and the store.
  onSubmit: async (entity: UserProxy) => saveUser(entity.values),
  afterSubmit: (result: unknown) => console.log("saved", result),
};

export const store = new Palistor({ config: { users, editUserForm } });

export function EditUser({ user, onDone }: { user: PalistorRef<User>; onDone: () => void }) {
  const form: UserProxy = useForm(user, (s) => s.editUserForm);
  const bio = form.bio as typeof form.bio & { loading: boolean }; // `loading` is missing from the field type

  async function save() {
    const result = await form.submit();
    if (result.success) onDone();
    else console.warn(result.errors); // [{ path: "email", message: "Invalid email" }]
  }

  if (form.loading) return <p>Loading…</p>;
  return (
    <div>
      <input value={form.name.value} onChange={(e) => form.name.onValueChange(e.target.value)} />
      <input value={form.email.value} onChange={(e) => form.email.onValueChange(e.target.value)} />
      {form.email.isInvalid && <em>{form.email.errorMessage}</em>}
      {bio.loading ? <p>Loading bio…</p> : <textarea value={bio.value} onChange={(e) => bio.onValueChange(e.target.value)} />}
      <button disabled={form.submitting || !form.dirty} onClick={save}>Save</button>
    </div>
  );
}
```

## Three levels of loading

| Level | Declared at | Starts | Receives | Result |
| --- | --- | --- | --- | --- |
| List resolve | `defineList({ resolve })` | First read of `items` / `length` / `map` / `loading`, a dependency change, `list.reload()` | Form values, store, `ctx` | The rows of the list |
| Template resolve | `resolve` on the edit template group | Mount of `useForm(row, selector)`, once per (row, template) | The entity proxy, store | An object merged into the row |
| Field resolve | `resolve` on a template leaf (list template or edit template) | First read of that field's `value` or `loading`, per row | The row's values, store | The field's value |

Every level's `onError(error, { notify, t })` gets the store's notifier and its current translator. `t` is not in the declared context type yet: in a plain config object such as `editUserForm` annotate it in full, `{ notify, t }: { notify: NotifyFn; t: TranslateFn }` (both types are exported by `palistor`); inside `defineList` use the cast shown in [list API](list-api.md). Source: `cube/core/resolve.test.ts` ("onError gets the store's translator").

### Template resolve

- `form.loading` is `true` while it runs. On failure `onError` is called and `loading` goes back to `false`.
- It runs once per (row, template). Unmounting and mounting the form again does not repeat it.
- `store.invalidate(id)` forgets every template of that row, so the next mount loads again. The optional second argument narrows it to one template and must be the template's config object (`editUserForm` above), not a proxy node.
- It has no dependency tracking. To reload after an external change, call `store.invalidate(id)` and remount the form.

### Field resolve

- It is lazy for every row: loading the list does not start it. A row whose field is never read is never resolved.
- The resolver receives the row's values (`row.id`, `row.name`, …), not the form values. `deps: ["name"]` and the values it reads refer to fields of the same row; a change re-runs it for that row.
- With the default `options.skipIfResolved: true` it does not run when the row already holds a value for the field that is neither `null`/`undefined` nor the template default. Set `skipIfResolved: false` to always run it.
- Its result becomes the field's dirty baseline. An `undefined` result leaves the field untouched.
- `options.retry: { attempts, delay }` retries before `onError`.
- One resolve state is shared by every view of the row: the list row and an open edit form show the same `loading` and trigger one request.
- A full `store.reset()` requests nothing. A field whose resolve has its result stays resolved, and its next read does not call the resolver; one that was in flight or had failed when the reset came starts over on its next read. Source: `cube/contract/sliceC/entityFieldResolve.test.tsx` ("store.reset() runs nothing by itself; the next read re-runs on store, keeps the loaded result on Cube"), `cube/core/hub.ts` (`resetEntities`).
- Do not read the resolved field itself inside its resolver: the result changes what was read, so the resolver restarts until the restart cap stops it.

## Submit a row

`row.submit()` (from either form of `useForm`) returns `Promise<SubmitResult>`:

1. `submitting` becomes `true`.
2. Every `validate` rule of the template runs against the row. Any message stops here with `{ success: false, errors: [{ path, message }] }`; `onSubmit` is not called. `isRequired` takes no part.
3. `onSubmit(entity, store)` runs. Its first argument is the entity proxy: `entity.id` is the id, `entity.name.value` a field value, `entity.values` the plain row.
4. `afterSubmit(result, { reset })` runs with the value `onSubmit` returned. Its `reset` does nothing for a row; call `row.reset()` yourself.
5. `submitting` becomes `false`. A throw from `onSubmit` rejects the promise.

A successful submit does not move the dirty baseline, and neither does `store.set`: the row stays `dirty`. To accept the saved values as the new baseline call `row.reset({ ...row.values })` (values passed to `reset` become the baseline) or reload the list. For a new row also call `store.rekey(tempId, saved.id)`.

## Common mistakes

### HIGH — Sending the `onSubmit` argument as the request body

Wrong: `onSubmit: async (values) => api.updateUser(values.id, values)` on an edit template.

Correct: `onSubmit: async (entity: PalistorEntityProxy<User>) => api.updateUser(entity.id, entity.values)`.

Why: a row's `onSubmit` receives the entity proxy, whose keys are field proxies, not the plain values a form group's `onSubmit` gets. Source: `cube/contract/sliceC/entityTemplateResolve.test.tsx` ("onSubmit called with entityProxy and store").

### HIGH — Expecting a field resolver to run when the list loads

Wrong: declaring `isOnline: { value: null, resolve }` in the list template and waiting for every row to resolve without reading the field.

Correct: render the field (`row.isOnline.value` or `.loading`) in the row component; each rendered row then resolves itself.

Why: field resolvers are lazy only. The list resolver, `store.set` and `list.add` never start them. Source: `cube/contract/sliceC/entityFieldResolve.test.tsx` ("the list resolver loads entities without triggering field resolves").

### HIGH — Reading form values in a field resolver

Wrong: `resolver: async (values) => api.check(values.filter)` or `deps: ["filter"]` on a template field, where `filter` is a form field.

Correct: read row fields (`row.id`) and take everything else from `store.context` or `store.getValues()`.

Why: a field resolver's first argument and its `deps` are scoped to the row. A form-level key is `undefined` there and never triggers a re-run. Source: `cube/core/resolve.ts` (`execute`: `base = cube.item ?? hub.root`), `cube/contract/sliceC/entityFieldResolve.test.tsx`.

### MEDIUM — Passing a proxy node to `store.invalidate`

Wrong: `store.invalidate(id, store.proxy.editUserForm)`.

Correct: `store.invalidate(id)`, or `store.invalidate(id, editUserForm)` with the template's config object.

Why: the loaded-template cache is keyed by the config object. A proxy node matches nothing, so the template is not loaded again. Source: `cube/contract/sliceC/entityTemplateResolve.test.tsx` ("invalidate(id, templateNode) clears only that pair").

### MEDIUM — Using `store.invalidate` to remove or refresh a row

Wrong: `store.invalidate(id)` to delete a row or to reload the list.

Correct: `store.delete(id)` removes the entity; `list.reload()` reloads the list; `store.invalidate(id)` only makes the next `useForm(row, selector)` mount run the template resolve again.

Why: `invalidate` touches the loaded-template cache and nothing else: the row, its values and its list membership stay. Source: `cube/palistor.ts` (`invalidate`), `cube/contract/sliceC/entityTemplateResolve.test.tsx`.
