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

Everything is exported from the root `@projectint/palistor` entry point. Deep imports are available but optional.

```ts
// Root import (preferred) — covers all public API
import {
  Palistor, useForm, usePersist, useTranslator, useNotifier, useStoreContext, defineList,
  localStorageDriver, sessionStorageDriver,
} from "@projectint/palistor";

import type {
  FormConfig, TranslateFn, MaybeComputed, DeepPartialValues,
  ConfigNode, FieldProxyNode, GroupProxyNode, ConfigProxy,
  ExtractValues, ProxyStoreOptions, ProxyStore, Unsubscribe,
  PalistorProxy, PalistorRef, PalistorList, InferEntity,
  TypedListNode, ListResolver, TemplateConfig,
  PersistDriver, PersistOptions, PersistManager,
  Resolve, NotifyFn, ResolveErrorContext,
} from "@projectint/palistor";

```

> **Note:** `MaybeTranslatable` is not re-exported from the root. Import directly if needed:
> `import type { MaybeTranslatable } from "@projectint/palistor/store/store";`

## TypeScript Types

### Inferring values type from config

```ts
const config = {
  name: { value: "" },
  age:  { value: 0 },
  address: { city: { value: "" }, country: { value: "RU" } },
};

type FormValues = ExtractValues<typeof config>;
// → { name: string; age: number; address: { city: string; country: string } }
```

Combine with `DeepPartialValues<FormValues>` for `initialValues` or patch objects.

### Typing props without importing the config

`PalistorProxy<T>` maps a plain values interface to the proxy tree:

```ts
import type { PalistorProxy } from "@projectint/palistor";

interface UserData { name: string; email: string; address: { city: string } }
type Props = { user: PalistorProxy<UserData> };
// user.name → FieldProxyNode<string>, user.address → PalistorProxy<{ city: string }>
```

> **Note:** `Palistor<T>` (the mapped type in `types.ts`) is exported as `PalistorProxy` because the name `Palistor` is taken by the store class. Do not use `import type { Palistor }` for prop typing — it resolves to the class constructor type.

For lists: `interface FormData { users: Array<{ name: string }> }` → `form.users → ListProxyNode<...>`.

### Entity refs in props

```ts
import type { PalistorRef, InferEntity } from "@projectint/palistor";

function UserRow({ user }: { user: PalistorRef<{ name: string; email: string }> }) {
  const u = useForm(user, (s) => s.userTemplate);
  return <span>{u.name.value}</span>;
}
```

`PalistorList<TEntity>` is the corresponding typed list: `ListProxyNode<PalistorRef<TEntity>>`.

### defineList — fully typed list node

Prefer `defineList<TEntity>()` over raw array syntax (same resolver shape as List Node):

```ts
const users = defineList<User>({
  template: { id: { value: "" }, name: { value: "", isRequired: true }, email: { value: "" } },
  resolve: { resolver: async (values) => api.getUsers(values.filter), deps: ["filter"], onError: (err, { notify }) => notify("Failed") },
});
```

### Config utility types reference

| Type | Purpose |
|------|---------|
| `MaybeComputed<TResult, TValues>` | `isVisible`, `isRequired`, `value` — static or `(values) => T` |
| `DeepPartialValues<T>` | `initialValues`, `setter` result, `setValues` patches |
| `TranslateFn` | Compatible with next-intl `t`, i18next `t`, any `(...args) => string` |
| `ExtractValues<TConfig>` | Derive plain values type from a config object |
| `ConfigProxy<TConfig>` | Full proxy type returned by `useForm(store)` |
| `PalistorProxy<T>` | Values-based proxy — use for prop types in child components |
| `PalistorRef<TEntity>` | Opaque entity proxy handle — for single entity props |
| `PalistorList<TEntity>` | Typed list — `ListProxyNode<PalistorRef<TEntity>>` |
| `InferEntity<T>` | Extract entity type from `PalistorRef<TEntity>` |
| `TemplateConfig<TEntity>` | Typed template — keys of entity mapped to `ConfigNode<TEntity[K]>` |
| `ListResolver<TEntity>` | Typed resolver — `(values) => Promise<TEntity[]>` |

## Config Declaration

Every form starts with a config object — a tree where leaves have `value` and groups are plain objects.

### Leaf Node (field)

```ts
email: {
  value: "",                           // initial value (or computed: (values) => ...)
  label: (t) => t("form.email"),       // translatable: (t, values?) => string
  placeholder: (t) => t("form.emailPlaceholder"),
  description: "Contact email",        // static or translatable
  isRequired: true,                    // static or (values) => boolean
  isVisible: (values) => values.contactMethod === "email",
  isReadOnly: false,
  isDisabled: false,
  validate: (value, values, t) => {
    if (!value.includes("@")) return t("validation.email");
  },
  formatter: (value) => String(value).trim().toLowerCase(),
  setter: (value, values, prev) => ({
    email: value,
    domain: value.split("@")[1] ?? "",   // patch sibling fields
  }),
  onChange: async ({ fieldKey, newValue, previousValue, allValues }) => {
    // fire-and-forget — runs on ANY field change in this group
    // return patch object, void, or Promise<patch | void>
    await analytics.track(fieldKey, newValue);
    return { lastModified: Date.now() };
  },
  dependencies: ["contactMethod"],     // explicit deps for recompute
}
```

### Group Node (container)

```ts
passport: {
  // No `value` key → this is a group
  number: { value: "", isRequired: true },
  issuedDate: { value: "" },

  // Group-level hooks
  isVisible: (values) => values.needsPassport,
  beforeSubmit: (values) => ({ ...values, number: values.number.replace(/\s/g, "") }),
  onSubmit: async (thisGroupValues, store) => { await api.save(thisGroupValues); },
  afterSubmit: (result, { reset }) => { reset(); },
  reset: (defaults) => ({ ...defaults, issuedDate: "" }),
  resolve: {
    resolver: async (thisForm, store) => {
      // thisForm is a tracking write-proxy: reads → auto-deps, writes → batched
      const data = await api.getPassport(thisForm.userId);
      return { number: data.number, issuedDate: data.date };
    },
    optimisticResolver: (values) => ({ number: "Loading..." }),
    onError: (error, { notify }) => notify("Failed to load passport"),  // required
    deps: ["userId"],           // explicit deps (merged with auto-deps after first run)
    options: {
      lazy: true,               // default; false = eager on init
      suspense: false,          // throw Promise for React <Suspense>
      retry: {                  // retry on error before calling onError
        attempts: 3,            // default: 0 (no retries)
        delay: 1000,            // default: 1000 ms
      },
    },
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
        return await api.getUsers(values.filter); // → Array<{ id, name, email }>
      },
      onError: (err, { notify }) => notify(err.message),
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

// Entity mode — TWO forms. Choose based on your needs:
//
// 1. useForm(entityProxy)  — use when the list template already has all needed fields and rules.
//    Entity comes from list.items or list.getById. Reads the list's own template.
//    Most common case — just read/write what the list already defines.
function EditUserSimple({ userProxy }: { userProxy: PalistorRef<UserData> }) {
  const u = useForm(userProxy); // uses list's own template fields
  return <input value={u.name.value} onChange={e => { u.name.value = e.target.value }} />;
}

// 2. useForm(entityProxy, (s) => s.editUserForm)  — use ONLY when the edit form needs
//    DIFFERENT fields, validators, labels, or an async resolve that the list template doesn't have.
//    Example: list shows (name, role), but editUserForm adds (email, bio, department, phone)
//    with separate validators and a resolve that fetches extra data.
//    The selector picks any group node from the store — its structure defines what's exposed.
//    On mount: bind + triggerResolve (skipped if already resolved from a previous open).
//    On unmount: unbind (resolved cache survives — next open is instant).
function EditUserDetailed({ userProxy }: { userProxy: PalistorRef<UserData> }) {
  const u = useForm(userProxy, (s) => s.editUserForm); // different template with extra fields
  return <input value={u.name.value} onChange={e => { u.name.value = e.target.value }} />;
}
```

### useTranslator — register i18n

```tsx
useTranslator(store, useTranslations()); // next-intl or any (key) => string
```

### useNotifier — register error notification

```tsx
useNotifier(store, (message) => toast.error(message));
```

### useStoreContext — set non-reactive context

Context is a non-reactive bag of global variables (accountId, tenant, etc.) that are **not form fields**. Context does not appear in `getValues()`, `submit`, or `persist`. It is available in all callbacks (resolve.resolver, onSubmit, onChange, …) via `store.context`.

```tsx
// In layout/provider — set context from React
function Layout({ children }: { children: React.ReactNode }) {
  const accountId = useAccountId();
  useStoreContext(store, useMemo(() => ({ accountId }), [accountId]));
  return <>{children}</>;
}

// Or imperatively (outside React):
store.setContext({ accountId: "abc", tenant: "acme" });
store.context.accountId; // read
```

In config — read from `store` argument:

```ts
resolve: {
  resolver: async (values, store) => api.fetchUsers(store.context.accountId),
  deps: ["filter"],
},
onSubmit: async (values, store) => {
  await api.save({ ...values, accountId: store.context.accountId });
},
```

**Lifecycle (hook):** mount → `store.setContext(ctx)`, unmount → `store.setContext({})`.

### usePersist — auto-save to storage

```tsx
usePersist(store, {
  key: "order-form",
  driver: localStorageDriver,     // or sessionStorageDriver, or custom PersistDriver
  debounce: 100,                  // ms (default: 100). 0 = immediate
  pick: ["email", "phone"],       // only persist these top-level keys (optional)
  omit: ["password"],             // exclude these (optional, ignored if pick set)
  serialize: JSON.stringify,      // custom serializer (default: JSON.stringify)
  deserialize: JSON.parse,        // custom deserializer (default: JSON.parse)
});
```

**PersistManager** (`store.persist`) public methods: `flush()` (force-save immediately), `clear()` (remove from storage), `enable(options)`, `disable()`, `hydrate()`, `isEnabled()`.

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

| Property/Method | Type | Description |
|-----------------|------|-------------|
| `items` | `ReadonlyArray<EntityProxy>` | All entities in order |
| `length` | `number` | Item count |
| `loading` | `boolean` | List resolver running |
| `dirty` | `boolean` | Item IDs differ from initial |
| `map(fn)` | `R[]` | `(item, index, id) => R` — iterate for rendering |
| `add(id: string)` | `void` | Add existing entity by ID |
| `add(values: Record)` | `TItem` | Add from values object — **returns created entity proxy** |
| `remove(id)` | `void` | Remove from list (entity stays in registry) |
| `getById(id)` | `EntityProxy` | Find item by ID |
| `setItems(ids)` | `void` | Bulk replace list contents |
| `[Symbol.iterator]` | | Iterable |

## Store Public Methods

```ts
// Entity operations
store.set({ id: "u1", name: "Alice" });    // upsert entity (or array)
store.delete("u1");                         // remove entity from registry
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
store.getValues();                          // deep snapshot (plain object)
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

### List rendering

```tsx
function UserList() {
  const form = useForm(store);
  return form.users.map((user, i, id) => <UserRow key={id} user={user} />);
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
| Expecting `store.delete(id)` to remove from lists | `delete` removes from registry; use `list.remove(id)` for list |
| Array config with >2 elements | List node is `[template]` or `[template, listConfig]` — max 2 elements |
| Ignoring `add(values)` return | `add(values)` returns the created `TItem` proxy — use it |
| Omitting `resolve.onError` | `onError` is **required** on resolve config — always provide it |
| `useForm(store, (s) => s.subForm)` — passing store as first arg with selector | Not valid. Use `useForm(store)` then access `.subForm` from the returned proxy. Two-arg form is entity-only: `useForm(entityProxy, selector)` where `entityProxy` comes from `list.items`/`list.getById` |

## Pipelines Reference

| Pipeline | Trigger | Steps |
|----------|---------|-------|
| **Write** | `form.field.value = X` | format → store → validate → recompute → dirty → notify → onChange |
| **Submit** | `form.submit()` | submitting=true → revalidate → validate → `beforeSubmit` → `onSubmit` → `afterSubmit` → submitting=false |
| **Reset** | `form.reset(vals?)` | build reset patch → apply → capture initial → recompute → notify |
| **Resolve** | GET on idle group with resolver | optimistic → loading=true → resolver (+ retry) → apply patch → merge initial → loading=false → notify |
| **onChange** | After write pipeline | fire ancestors' `onChange` handlers (async) → apply returned patches |

## Re-render Optimization

- `useForm(subtree)` in child components creates independent tracking — child re-renders don't cascade to parent
- Parent passing `form.passport` as prop does NOT re-render when passport's fields change (no field state read = no tracking)
- Spread `{...form.email}` reads all field props — component re-renders on any prop change of that field
- Reading only `form.email.value` — re-renders only on value change, not on visibility/validation changes
