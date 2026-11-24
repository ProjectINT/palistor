# Config options

Every key a field (leaf) or a group accepts, what each callback receives, and the order in which a
write and a submit run them.

## Which `values` a callback sees

| Argument | Is |
| --- | --- |
| `values` of `value`, `validate`, `setter`, `isVisible`, `isRequired`, `isDisabled`, `isReadOnly`, leaf `beforeSubmit` | the **parent group's** values — the field's siblings. The whole form for a top-level node |
| `values` of `formatter`, `label`, `placeholder`, `description`; `allValues` of `onChange` | the **whole form** |
| `values` of a group resolver | the whole form, with tracked reads (see the async resolve reference) |

A callback re-runs when a value it read changes. `dependencies` is accepted for backward compatibility
and ignored.

Annotate callback parameters with the type of the object from this table: nothing infers them, and an
un-annotated parameter is error TS7006 in a `strict` project.

## Field (leaf) keys

A node is a field when it has a `value` key.

| Key | Signature | Behavior |
| --- | --- | --- |
| `value` | `T` or `(values) => T` | Initial value. A function makes the field computed. `null` / `undefined` are stored as `""`: use an empty value of the field's own type (`""`, `0`, `false`, `[]`) |
| `label`, `placeholder`, `description` | `string` or `(t, formValues) => string` | `t` is the function registered with `useTranslator`; without one it returns its key |
| `isRequired` | `boolean` or `(values) => boolean` | Empty means `null`, `undefined`, a blank string or `NaN`; `false`, `0` and `[]` count as filled, so a must-be-checked box needs `validate`. Message: `"required"` unless `validate` returns one |
| `isVisible`, `isDisabled`, `isReadOnly` | `boolean` or `(values) => boolean` | Exposed on the field for the adapter to act on. None of them switches validation off |
| `validate` | `(value, values, t) => string \| undefined \| false` | Runs on submit and, once errors are shown, on every change |
| `formatter` | `(raw, formValues) => stored` | Runs on every write and on `setValues`, before the value is stored. With a bound input that is every keystroke: a formatter that removes what was just typed (a trim) turns the write into a no-op and logs the "Write skipped" warning |
| `setter` | `(value, values, previous) => patch` | Must return an object. The patch is applied to the field's own group |
| `onChange` | `(info) => patch \| void \| Promise<patch \| void>` | Fire-and-forget after a write; see below |
| `beforeSubmit` | `(value, values) => value` | Transforms the payload only; the store keeps its value |
| `onSubmit` | `(value, store, parent) => unknown` | Runs on `field.submit()` only |
| `afterSubmit` | `(result, { reset }) => void` | `reset()` resets the field's group |
| `componentProps` | `Record<string, unknown>` | Static extra props: each key is added to the field's spread unless the name is already taken |
| `resolve` | `Resolve<T>` | Only inside a list template: see the `palistor-lists` skill |

## Group keys

A node without `value` is a group; every other object-valued key is a child.

| Key | Signature | Behavior |
| --- | --- | --- |
| `isVisible`, `isRequired`, `isDisabled`, `isReadOnly` | `boolean` or `(values) => boolean` | `values` are the parent group's |
| `beforeSubmit` | `(values) => values` | Transforms the payload; may be async |
| `onSubmit` | `(values, store, parent) => unknown` | `values` is a plain copy of the group; `parent` is the parent group's proxy (`undefined` at the root) |
| `afterSubmit` | `(result, { reset }) => void` | `reset()` resets this group |
| `reset` | `(defaults) => values` | Shapes what a `reset()` without arguments restores |
| `onChange` | `(info) => patch \| void` | Fires for a change of any field below; the patch is applied to this group |
| `resolve` | `Resolve` | Loads data into the group: see the async resolve reference |

Names a child field cannot take, because the group itself answers them:

- `values`, `submit`, `setValues`, `submitting`, `revalidate`, `onValueChange` — the store throws when
  it is built;
- every config key (`label`, `isVisible`, `reset`, `resolve`, …) and `loading`, `dirty`, `isInvalid`,
  `errorMessage` — read as the group's own option, so the object silently does not become a field.

## `onChange` in detail

```ts
import { Palistor } from "palistor";

export const shippingStore = new Palistor({
  config: {
    address: {
      country: {
        value: "",
        // Leaf: fieldKey is "country"; the patch goes to the `address` group.
        onChange: async ({ newValue }: { newValue: unknown }) => {
          const cities = await api.getCities(newValue);
          return { city: cities[0] ?? "" };
        },
      },
      city: { value: "" },
      // Group: fires for any field below; fieldKey is the path relative to this group.
      onChange: ({ fieldKey }: { fieldKey: string }) => {
        if (fieldKey === "city") return { confirmed: false };
      },
      confirmed: { value: false },
    },
  },
});
```

- A write fires the field's own `onChange`, then every ancestor group's, up to the root (where
  `fieldKey` is the full path, `"address.country"`).
- Handlers run asynchronously and independently; a thrown error or rejected promise is swallowed.
- `setValues`, `reset` and resolver results do not fire `onChange`.

Use `setter` for a synchronous cascade that must be in place within the same write, `onChange` for a
side effect or an async follow-up.

## Order of a write

`field.value = raw` and `field.onValueChange(raw)` are the same operation:

1. `formatter(raw, formValues)`;
2. unchanged value → the write is skipped with a console warning (a sign of a write during render or a
   redundant update);
3. the value is stored;
4. `setter` → its patch is applied to the group;
5. subscribers are notified once;
6. `onChange` handlers fire.

`group.setValues(patch)` and `store.setValues(patch)` run `formatter` per field and notify once; they
skip `setter` and `onChange`, and ignore unknown keys and list keys.

## Order of a submit

`store.submit()`, `group.submit()` and `field.submit()` run the same steps on their own subtree:

1. `submitting` becomes `true`; errors of the whole subtree become visible;
2. the payload is built: values → each field's `beforeSubmit` → the node's own `beforeSubmit`;
3. every field of the subtree is validated (`isRequired`, then `validate`), hidden ones included;
   any error → `{ success: false, errors }`, nothing else runs;
4. `onSubmit(payload, store, parent)`;
5. `afterSubmit(result, { reset })`;
6. after a successful root or group submit the persisted draft is cleared (see the integrations
   reference);
7. `submitting` becomes `false` — also when `onSubmit` throws, in which case `submit()` rejects.

Validation checks the stored values, not the output of `beforeSubmit`.

A single field with `onSubmit` saves on demand — a toggle that persists itself:

```ts
import { Palistor } from "palistor";
import type { PalistorProxy } from "palistor";

interface NotificationValues {
  emailEnabled: boolean;
  frequency: string;
}

export const settingsStore = new Palistor({
  config: {
    notifications: {
      emailEnabled: {
        value: false,
        // parent is the `notifications` group proxy: siblings are reachable through it.
        onSubmit: async (value: boolean, _store: unknown, parent: PalistorProxy<NotificationValues>) =>
          api.patchSettings({ emailEnabled: value, frequency: parent.frequency.value }),
      },
      frequency: { value: "daily" },
    },
  },
});

// In a handler: write, then save that one field.
export async function toggleEmail(next: boolean) {
  settingsStore.proxy.notifications.emailEnabled.value = next;
  return settingsStore.proxy.notifications.emailEnabled.submit();
}
```

## Reset and dirty

- `reset()` restores the baseline: the config defaults merged with `initialValues`, moved forward by
  every successful resolve and by `reset(values)`. Errors are hidden again.
- `reset(values)` applies `values` and makes the result the new baseline.
- `dirty` on a field: the value differs from the baseline (objects and arrays are compared by their
  JSON). On a group: any field below is dirty, or a list below is (its membership, or that of a list
  nested in its rows: the `palistor-lists` skill).
