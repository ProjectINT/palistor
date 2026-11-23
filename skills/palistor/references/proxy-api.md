# Proxy and store API

What a component reads from `useForm(...)` and what code outside React calls on the store.

## Field (`form.email`)

| Member | Type | In the spread | Notes |
| --- | --- | --- | --- |
| `value` | `T` (read/write) | yes | Assigning runs the write steps (formatter → store → setter → onChange) |
| `onValueChange(v)` | function | yes | Same as assigning `value`; a stable reference, safe as a prop |
| `label`, `placeholder`, `description` | `string \| undefined` | yes | Already translated and computed |
| `isRequired`, `isReadOnly`, `isDisabled`, `isVisible` | `boolean` | yes | Already computed |
| `isInvalid` | `true \| undefined` | yes | `undefined` while errors are hidden or the field is valid |
| `errorMessage` | `string \| undefined` | yes | Only while `isInvalid` is `true` |
| `dirty` | `boolean` | no | Differs from the baseline |
| `submitting` | `boolean` | no | A `field.submit()` is running |
| `submit()` | `Promise<SubmitResult>` | no | Validates and submits this field alone (its own `onSubmit`) |

`{...form.email}` yields exactly the "yes" rows plus the keys of the field's `componentProps`.
The static type of the spread is the full `FieldProxyNode<T>`, so `dirty` / `submitting` / `submit`
type-check on an adapter's props but are `undefined` at runtime unless passed explicitly:
`<Field {...form.email} dirty={form.email.dirty} />`.

## Group (`form.address`, and the root returned by `useForm(store)`)

| Member | Type | Notes |
| --- | --- | --- |
| child keys | field / group / list proxies | One per child of the config node |
| `values` | object | Live values of the subtree; the same reference on every read. Not a clone |
| `submit()` | `Promise<SubmitResult>` | Validates and submits this subtree |
| `reset(values?)` | `void` | Back to the baseline, or to `values`, which become the new baseline |
| `setValues(patch)` | `void` | Bulk write: one notification, no `setter` / `onChange` |
| `submitting` | `boolean` | This node's submit is running |
| `dirty` | `boolean` | Any field below differs from the baseline |
| `loading` | `boolean` | The group's `resolve` is running or about to run. Reading it starts a lazy resolve, as reading a child does (async resolve reference) |
| `revalidate` | `boolean` | Errors of this subtree are visible (set by a submit, cleared by `reset`) |
| `isVisible` | `boolean` | The group's own flag; `true` unless configured |
| `isRequired`, `isReadOnly`, `isDisabled` | `boolean \| undefined` | The group's own flags; falsy unless configured |
| `isInvalid`, `errorMessage` | `true \| undefined`, `string \| undefined` | The group's **own** `validate` / `isRequired` only — not an aggregate of its fields |

`SubmitResult` is `{ success: true; result?: unknown } | { success: false; errors: Array<{ path: string; message: string }> }`.
`path` is relative to the node that was submitted (`"address.city"` from the root, `"city"` from
`form.address.submit()`).

There is no aggregate validity flag. To know whether a form is valid, submit it and read the result.

## Re-rendering

- `useForm` returns a tracking proxy. Reading any state of a node (a field's `value`, `isInvalid`,
  a group's `dirty`, …) subscribes the component to that node; the component re-renders when any
  observable state of a subscribed node changes.
- Drilling into children without reading state (`form.address` passed as a prop) subscribes to
  nothing.
- Give a section its own subscription by calling `useForm(subtree)` in the child component.

## Store (`new Palistor(...)`) — outside React

```ts
import { Palistor } from "palistor";

const store = new Palistor({
  config: { email: { value: "" }, address: { city: { value: "" } } },
  initialValues: { email: "ann@example.com" }, // deep-partial; overrides config defaults
});

store.getValues();                         // detached deep clone: { email, address: { city } }
store.setValues({ address: { city: "Oslo" } });
store.proxy.email.value = "bob@example.com"; // imperative write, same steps as in a component
await store.submit();                      // SubmitResult of the root
store.reset();                             // back to the baseline
store.reset({ email: "" });                // apply and make it the new baseline

const stop = store.subscribeGlobal(() => console.log(store.getValues())); // any change
stop();
```

The constructor also takes `context`, `translator` and `notifier` (integrations reference),
`fieldMapping` (the `palistor-field-mapping` skill) and, for a screen rendered on the server,
`initialData` and `server` (the `palistor-ssr` skill).

| Member | Use |
| --- | --- |
| `getValues()` | Snapshot for logging, serialization, non-reactive reads |
| `setValues(patch)`, `reset(values?)`, `submit()` | Same as on the root group |
| `proxy` | The raw tree for imperative reads and writes. Never pass it, or a part of it, to `useForm` |
| `subscribeGlobal(listener)` | Called after every change; returns an unsubscribe function |
| `context`, `setContext(patch)` | Data for callbacks that is not part of the form (integrations reference) |
| `setTranslator(t)`, `setNotifier(fn)` | What `useTranslator` / `useNotifier` call (integrations reference) |
| `persist` | Draft persistence manager (integrations reference) |
| `start()` | Runs what a store starts by itself: eager resolves, a flow's first step, resolves that were already read. The constructor calls it wherever `window` exists; in a Node script or a test without a DOM call it yourself (async resolve reference). Idempotent |
| `set`, `delete`, `rekey`, `invalidate` | List entities: see the `palistor-lists` skill |

`subscribe(node, listener)`, `getVersion()` and `getNodeVersion(node)` exist for `useForm` itself;
application code does not need them.
