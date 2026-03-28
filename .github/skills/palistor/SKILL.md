---
name: palistor
description: "Build forms with the Palistor reactive form state manager. Use when: creating form configs, writing React components with useForm, adding validation/formatters/setters, working with lists/entities, configuring resolve/persist/submit pipelines, debugging form state."
---

# Palistor — Reactive Form State Manager

## When to Use

- Declaring form config objects (fields, groups, lists)
- Writing React components that read/write form state via `useForm`
- Adding validation, formatters, setters, computed visibility/required
- Working with entity lists (add/remove/edit items)
- Configuring async resolve, persist, submit/reset pipelines
- Debugging re-render or dirty tracking issues

## Architecture Overview

Palistor is a proxy-based reactive form engine. State lives outside React. Components subscribe via `useSyncExternalStore` through a tracking proxy that records which fields were read — only those trigger re-renders.

```
React Component  →  Tracking Proxy (layer 2)  →  Store Proxy (layer 1)  →  Config + nodeState
```

- **Config** is an immutable tree of node objects (leaf nodes have `value`, group nodes don't)
- **nodeState** (`WeakMap<node, FieldState>`) holds runtime state (value, isVisible, isInvalid, dirty, etc.)
- **SET** on `value` triggers the Write Pipeline (format → store → validate → recompute → notify)
- **Spread-safe**: `{...form.email}` hides internal config keys; only proxy props are exposed

## Imports

```ts
// Class
import { Palistor } from "@palistor/store/store";

// React hooks
import { useForm } from "@palistor/react/useForm";
import { usePersist } from "@palistor/react/usePersist";
import { useTranslator } from "@palistor/react/useTranslator";
import { useNotifier } from "@palistor";

// Types
import type {
  FormConfig, TranslateFn, MaybeComputed, DeepPartialValues,
  ConfigNode, FieldProxyNode, GroupProxyNode, ConfigProxy,
  ExtractValues, ProxyStoreOptions, ProxyStore,
} from "@palistor";

// Persist
import type { PersistDriver, PersistOptions } from "@palistor";
import { localStorageDriver, sessionStorageDriver } from "@palistor";

// Resolve
import type { Resolve, NotifyFn, ResolveErrorContext } from "@palistor";
```

## Config Declaration

Every form starts with a config object — a tree where leaves have `value` and groups are plain objects.

### Leaf Node (field)

```ts
email: {
  value: "",                           // initial value (or computed: (values) => ...)
  label: (t) => t("form.email"),       // translatable string
  placeholder: (t) => t("form.emailPlaceholder"),
  description: "Contact email",        // static or (t, values) => ...
  isRequired: true,                    // static or (values) => boolean
  isVisible: (values) => values.contactMethod === "email",
  isReadOnly: false,
  isDisabled: false,
  validate: (value, values, t) => {
    if (!value.includes("@")) return t("validation.email");
  },
  formatter: (value) => String(value).trim().toLowerCase(),
  setter: (value, values, prev) => ({
    // patch sibling fields when this field changes
    domain: value.split("@")[1] ?? "",
  }),
  onChange: ({ fieldKey, newValue, previousValue, allValues }) => {
    // fire-and-forget side-effect when ANY field in this group changes
    // return a patch object or void
  },
  dependencies: ["contactMethod"],     // explicit deps for recompute
  types: { dataType: "String", type: "string" },
  componentProps: { maxLength: 100 },  // pass-through to UI component
}
```

### Group Node (container)

```ts
passport: {
  // No `value` key → this is a group
  number: { value: "", isRequired: true, validate: ... },
  issuedDate: { value: "", ... },

  // Group-level hooks
  isVisible: (values) => values.needsPassport,
  beforeSubmit: (values) => ({ ...values, number: values.number.replace(/\s/g, "") }),
  onSubmit: async (thisGroupValues, store) => { await api.save(thisGroupValues); },
  afterSubmit: (result, { reset }) => { reset(); },
  reset: (defaults) => ({ ...defaults, issuedDate: "" }),
  resolve: {
    resolver: async (values, trackingProxy) => {
      const data = await api.getPassport(values.userId);
      return { number: data.number, issuedDate: data.date };
    },
    deps: ["userId"],           // re-trigger when these change
    lazy: true,                 // default; false = eager on init
    suspense: false,            // throw promise for React <Suspense>
    optimisticResolver: (values) => ({ number: "Loading..." }),
    onError: (error, { notify }) => notify("Failed to load passport"),
  },
}
```

### List Node

```ts
users: [
  // Element [0]: template — describes fields of each entity
  { id: { value: "" }, name: { value: "" }, email: { value: "" } },

  // Element [1] (optional): list config
  {
    resolve: {
      resolver: async (values, store) => {
        const users = await api.getUsers(values.filter);
        return users; // Array<{ id, name, email, ... }>
      },
      deps: ["filter"],
    },
  },
]
```

## Creating a Store

```ts
const store = new Palistor<typeof config>({
  config: myFormConfig,
  initialValues: { email: "user@example.com" }, // partial, deep-merged
});
```

## React Hooks

### useForm — connect component to store

```tsx
// Root — pass the store
function OrderForm() {
  const form = useForm(store);
  return <input value={form.email.value} onChange={e => { form.email.value = e.target.value }} />;
}

// Child — pass a proxy subtree (independent re-renders)
function PassportSection({ passport }: { passport: typeof form.passport }) {
  const p = useForm(passport);
  if (!p.isVisible) return null;
  return <input value={p.number.value} onChange={e => { p.number.value = e.target.value }} />;
}

// Entity mode — bind entity from list to a template
function EditUser({ userProxy }) {
  const u = useForm(userProxy, (s) => s.editUserForm);
  return <input value={u.name.value} onChange={e => { u.name.value = e.target.value }} />;
}
```

### useTranslator — register i18n

```tsx
function App() {
  useTranslator(store, useTranslations()); // next-intl or any (key) => string
  // ...
}
```

### useNotifier — register error notification

```tsx
useNotifier(store, (message) => toast.error(message));
```

### usePersist — auto-save to storage

```tsx
usePersist(store, {
  key: "order-form",
  driver: localStorageDriver,  // or sessionStorageDriver
  debounce: 300,               // ms, default
  pick: ["email", "phone"],    // only persist these (optional)
  omit: ["password"],          // exclude these (optional, ignored if pick set)
});
```

## Field Proxy API (what you read in components)

Accessing `form.email` returns a `FieldProxyNode`:

| Property | Type | R/W | Description |
|----------|------|-----|-------------|
| `value` | `TValue` | R/W | Current value; SET triggers write pipeline |
| `label` | `string \| undefined` | R | Computed from config + translator |
| `placeholder` | `string \| undefined` | R | Computed from config + translator |
| `description` | `string \| undefined` | R | Computed from config + translator |
| `isRequired` | `boolean` | R | Computed from config + allValues |
| `isReadOnly` | `boolean` | R | Computed from config + allValues |
| `isDisabled` | `boolean` | R | Computed from config + allValues |
| `isVisible` | `boolean` | R | Computed from config + allValues |
| `isInvalid` | `boolean \| undefined` | R | `undefined` before revalidate, then `true/false` |
| `errorMessage` | `string \| undefined` | R | Validation error string |
| `dirty` | `boolean` | R | Value differs from initial |
| `onValueChange` | `(v) => void` | R | Callback form of value setter |

**Spread-safe:** `{...form.email}` yields only these properties (config internals hidden).

## Group Proxy API

Accessing `form.passport` (a group node) returns:

| Property | Type | Description |
|----------|------|-------------|
| `isInvalid` | `boolean` | Any child invalid |
| `dirty` | `boolean` | Any child changed |
| `submitting` | `boolean` | Submit in progress |
| `loading` | `boolean` | Resolver running |
| `revalidate` | `boolean` | Show errors after failed submit |
| `isVisible` | `boolean` | Computed from config |
| `submit()` | `Promise<SubmitResult>` | Run submit pipeline for this group |
| `reset(values?)` | `void` | Reset to initial (or provided) values |
| `setValues(patch)` | `void` | Bulk update with single recompute |

Plus all child fields as proxy sub-properties.

## List Proxy API

Accessing `form.users` (a list node) returns:

| Property/Method | Type | Description |
|-----------------|------|-------------|
| `items` | `ReadonlyArray<EntityProxy>` | All entities in order |
| `length` | `number` | Item count |
| `loading` | `boolean` | List resolver running |
| `dirty` | `boolean` | Item IDs differ from initial |
| `map(fn)` | `R[]` | `(item, index, id) => R` — iterate for rendering |
| `add(id \| values)` | `void` | Add existing entity by ID, or upsert from values object |
| `remove(id)` | `void` | Remove from list (entity stays in registry) |
| `getById(id)` | `EntityProxy` | Find item by ID |
| `setItems(ids)` | `void` | Bulk replace list contents |
| `[Symbol.iterator]` | | Iterable |

## Store Public Methods

```ts
// Entity operations
store.set({ id: "u1", name: "Alice" });    // upsert entity (or array)
store.delete("u1");                         // remove entity
store.rekey("_tmp_1", "real_id");           // rename entity ID
store.invalidate("u1", templateNode?);      // clear resolve cache

// Form operations
store.submit();                             // run submit pipeline
store.reset(values?);                       // reset to initial
store.setValues(patch);                     // bulk update

// Subscriptions
store.subscribe(node, listener);            // per-node
store.subscribeGlobal(listener);            // any change

// State
store.getValues();                          // deep snapshot
store.getVersion();                         // global version counter
store.getNodeVersion(node);                 // per-node version

// Integration
store.setTranslator(t);                     // register i18n fn
store.setNotifier(fn);                      // register error notification fn
store.persist;                              // PersistManager instance
```

## Key Patterns

### Conditional visibility

```ts
cardNumber: {
  value: "",
  isVisible: (values) => values.paymentType === "card",
  isRequired: (values) => values.paymentType === "card",
  dependencies: ["paymentType"],
}
```

### Cascading setter (reset dependent fields)

```ts
country: {
  value: "",
  setter: (value, values, prev) => ({ city: "", shippingCost: 0 }),
}
```

### Phone formatter

```ts
phone: {
  value: "",
  formatter: (value) => {
    const digits = String(value).replace(/\D/g, "").slice(0, 11);
    // format as +X (XXX) XXX-XX-XX
    return formatPhoneDigits(digits);
  },
}
```

### List rendering

```tsx
function UserList() {
  const form = useForm(store);
  return form.users.map((user, i, id) => (
    <UserRow key={id} user={user} />
  ));
}
```

### Entity edit in modal

```tsx
function EditModal({ entityProxy, onClose }) {
  const u = useForm(entityProxy, (s) => s.editTemplate);
  return (
    <>
      <input value={u.name.value} onChange={e => { u.name.value = e.target.value }} />
      <button onClick={() => u.submit().then(onClose)}>Save</button>
    </>
  );
}
```

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Reading `form.field` without `useForm` | Always wrap in `useForm(store)` or `useForm(subtree)` for reactivity |
| Mutating config after creation | Config is treated as immutable — never mutate |
| Missing `dependencies` for computed | Use `dependencies: ["fieldName"]` for cross-field computed/visibility |
| Using `form.email.value` outside render | `store.getValues()` for non-reactive reads |
| Calling `store.submit()` vs `form.group.submit()` | Root `submit()` submits entire form; group `submit()` submits sub-tree |
| Expecting `store.delete(id)` to remove from lists | `delete` removes entity from registry; use `list.remove(id)` for list |
| Array config with >2 elements | List node is `[template]` or `[template, listConfig]` — max 2 elements |

## Pipelines Reference

| Pipeline | Trigger | Steps |
|----------|---------|-------|
| **Write** | `form.field.value = X` | format → store → validate → recompute → dirty → notify → onChange |
| **Submit** | `form.submit()` | submitting=true → revalidate → validate → `beforeSubmit` → `onSubmit` → `afterSubmit` → submitting=false |
| **Reset** | `form.reset(vals?)` | build reset patch → apply → capture initial → recompute → notify |
| **Resolve** | GET on idle group with resolver | optimistic → loading=true → resolver → apply patch → merge initial → loading=false → notify |
| **onChange** | After write pipeline | fire ancestors' `onChange` handlers → apply returned patches |

## Re-render Optimization

- `useForm(subtree)` in child components creates independent tracking — child re-renders don't cascade to parent
- Parent passing `form.passport` as prop does NOT re-render when passport's fields change (no field state read = no tracking)
- Spread `{...form.email}` reads all field props — component re-renders on any prop change of that field
- Reading only `form.email.value` — re-renders only on value change, not on visibility/validation changes
