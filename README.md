# Palistor

> A declarative framework for data-driven React interfaces — behavior, data and view as three separate layers

**English** | [Русский](./README.ru.md)

[![npm version](https://img.shields.io/npm/v/palistor.svg)](https://www.npmjs.com/package/palistor)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![react](https://img.shields.io/badge/react-%5E19-61dafb.svg)](https://react.dev)

**Palistor is a declarative framework for stateful, data-driven React interfaces.** It treats a screen as three independent layers — **configuration** (how it behaves), **data** (where its values come from) and **view** (how it renders) — and keeps them from leaking into each other. A two-layer proxy is the seam that binds them: reads become fine-grained subscriptions, writes run the behavior you declared. A component re-renders **only** for the exact fields it read.

```tsx
const store = new Palistor({
  config: {
    email: { value: "", isRequired: true },
    phone: { value: "", isVisible: (v) => v.email !== "" },
  },
});

function Form() {
  const form = useForm(store);
  return (
    <input
      value={form.email.value}
      onChange={(e) => (form.email.value = e.target.value)}
    />
  );
}
```

---

## The idea — three layers, not one store

Most React screens tangle three unrelated concerns inside components: how the screen **behaves** (validation, conditional fields, cross-field rules), where its **data** comes from (loading, caching, mutation) and how it **looks** (JSX). As the screen grows, the three braid together until every change touches everything. On top of that, the tangle of dependencies, useEffects, custom hooks and contexts keeps growing — and the screen ends up monolithic, unpredictable and hard to test.

Palistor pulls them apart:

```
┌── Configuration — behavior ──────────────┐   declarative · framework-agnostic
│  fields · validation · visibility ·      │   isVisible / isRequired / validate
│  cross-field rules · dependencies ·      │   formatter / setter / onSubmit
│  lifecycle                               │   fully testable without React
└─────────────────────┬────────────────────┘
                      │   proxy — the seam:
                      │   read  → subscribe to a field
                      │   write → run the declared pipeline
┌── Data — values & entities ──────────────┐   normalized entity registry
│  values cache · normalized registry ·    │   resolvers with auto-tracked deps
│  async resolvers                         │   retry · optimistic · Suspense
└─────────────────────┬────────────────────┘
                      │
┌── View — rendering ──────────────────────┐   useForm(store) → tracking proxy
│  read state · assign values · no logic   │   granular, per-field re-renders
└──────────────────────────────────────────┘
```

- **Configuration — behavior.** One declarative tree describes fields, validation, visibility, cross-field rules, dependencies and lifecycle (`onSubmit`, `resolve`). Pure and framework-agnostic — fully testable without React.
- **Data — values & entities.** Values flow through a normalized entity registry and async resolvers with automatically tracked dependencies, retry, optimistic updates and Suspense.
- **View — rendering.** Components only read reactive state and assign values. They carry no logic and re-render only for the fields they actually read.

The proxy is the seam between the layers: a **read** (`form.email.value`) subscribes the component to that field; a **write** (`form.email.value = x`) runs the pipeline you declared in the config — formatter → setter → recompute → notify. Nothing is wired by hand.

The payoff is that complexity grows **per layer**, not per component. A form, a wizard, a data table and an admin panel are the same three layers at different scale — which is why async loading, normalized lists, multi-step flows, persistence and i18n are part of the framework, not add-ons you bolt on later.

---

## Table of contents

- [Features](#features)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Concepts](#concepts)
- [API reference](#api-reference)
- [Async resolvers](#async-resolvers)
- [Lists & entities](#lists--entities)
- [Flows (step wizards)](#flows-step-wizards)
- [Field mapping](#field-mapping)
- [Persist](#persist)
- [i18n](#i18n)
- [Notifications](#notifications)
- [Store context](#store-context)
- [TypeScript](#typescript)
- [License](#license)

---

## Features

| | |
|---|---|
| **Granular re-renders** | A component subscribes only to the fields it read — nothing else triggers a re-render |
| **Computed field state** | `isVisible`, `isRequired`, `label`, validation errors are recomputed automatically from the config |
| **Proxy API** | Native syntax: `form.email.value = x` instead of dispatching actions |
| **Submit pipeline** | `beforeSubmit → validate → onSubmit → afterSubmit`, errors surface after the first failed submit |
| **Dirty tracking** | Per-field and per-group change flags; the baseline updates after resolve and reset |
| **Async resolvers** | Data loading with auto-tracked dependencies, retry, optimistic updates and React Suspense |
| **Lists & entities** | Normalized entity registry, list proxy with `add / remove / setItems`, per-entity templates |
| **Flows** | Step wizards via `defineFlow` / `defineStep`: navigation, branching, per-step validation |
| **Field mapping** | Rename field-state props to your UI kit's convention (`isRequired` → `required`, …) |
| **Persist** | Autosave to `localStorage`, `sessionStorage` or any custom driver — flow navigation included |
| **i18n** | Register a translator once — `label`, `placeholder`, `description` are translated everywhere |
| **Testability** | The core is framework-agnostic and fully testable without React |

---

## Installation

The package is published to the **public npm registry** as `palistor`.

```bash
npm install palistor
# or
yarn add palistor
# or
pnpm add palistor
```

**Peer dependency:** `react ^19`

> **Alternative — GitHub Packages.** The same package is available under the scoped
> name `@projectint/palistor`. Add to `.npmrc`:
> ```
> @projectint:registry=https://npm.pkg.github.com
> ```
> then `npm install @projectint/palistor`. The canonical name is `palistor`.

All public symbols are available from the root module:

```typescript
import {
  Palistor,
  useForm,
  usePersist,
  useTranslator,
  useNotifier,
  useStoreContext,
  defineList,
  defineFlow,
  defineStep,
  defineFieldMapping,
  localStorageDriver,
  sessionStorageDriver,
} from "palistor";
```

---

## Quick start

### 1. Describe the form

The config is declarative: field values, validation, visibility and lifecycle callbacks live in one tree. Create the store at module level.

```typescript
import { Palistor } from "palistor";

export const paymentStore = new Palistor({
  config: {
    paymentType: {
      value: "card",
      label: "Payment method",
    },
    cardNumber: {
      value: "",
      label: "Card number",
      placeholder: "0000 0000 0000 0000",
      isVisible: (v) => v.paymentType === "card",
      isRequired: (v) => v.paymentType === "card",
      validate: (value, v) =>
        v.paymentType === "card" && value.length < 16
          ? "Enter 16 digits"
          : undefined,
    },
    passport: {
      isVisible: (v) => v.paymentType === "bank",
      number:    { value: "", label: "Passport number", isRequired: true },
      issueDate: { value: "", label: "Issue date" },
    },
    amount: { value: 0, label: "Amount", isRequired: true },
  },
  initialValues: { paymentType: "card" },
});
```

### 2. Connect a component

```tsx
import { useForm } from "palistor";
import { paymentStore } from "./paymentStore";

function PaymentForm() {
  const form = useForm(paymentStore);

  return (
    <form onSubmit={(e) => { e.preventDefault(); paymentStore.submit(); }}>
      <Select
        value={form.paymentType.value}
        onChange={(e) => (form.paymentType.value = e.target.value)}
        label={form.paymentType.label}
      />

      {form.cardNumber.isVisible && (
        <Input
          value={form.cardNumber.value}
          onChange={(e) => (form.cardNumber.value = e.target.value)}
          label={form.cardNumber.label}
          isRequired={form.cardNumber.isRequired}
          isInvalid={form.cardNumber.isInvalid}
          errorMessage={form.cardNumber.errorMessage}
        />
      )}

      {form.passport.isVisible && <PassportSection passport={form.passport} />}

      <Button type="submit" isLoading={form.submitting}>Pay</Button>
    </form>
  );
}
```

### 3. Independent re-render for a child component

If a child needs **independent** tracking, pass the subtree down as a prop and call `useForm` on it:

```tsx
function PassportSection({ passport }) {
  // Own tracking proxy — re-renders only when passport fields change
  const p = useForm(passport);

  return (
    <>
      <Input value={p.number.value}    onChange={(e) => (p.number.value = e.target.value)}    label={p.number.label} />
      <Input value={p.issueDate.value} onChange={(e) => (p.issueDate.value = e.target.value)} label={p.issueDate.label} />
    </>
  );
}
```

> **Without `useForm` in the child** the component re-renders in cascade with its parent. That's fine for simple leaf components.

---

## Concepts

### Two node kinds: leaf and group

The node kind is determined by the presence of a `value` property:

```
Has  "value"  →  leaf node  (a form field)
No   "value"  →  group node (a container / section)
```

```typescript
const config = {
  // Leaf node — owns a value
  email: { value: "", isRequired: true },

  // Group node — a container with computed properties
  address: {
    isVisible: (v) => v.showAddress,
    city:    { value: "" },
    country: { value: "US" },
  },
};
```

### How tracking works

```
Render: the component reads form.email.value and form.phone.value
        → accessed = { emailNode, phoneNode }

SET form.city.value   → cityNode version++  → snapshot unchanged → no re-render  ✓
SET form.email.value  → emailNode version++ → snapshot changed   → re-render     ✓
```

A parent that only navigates (`form.passport`) without reading field state does **not** re-render when fields inside `passport` change.

### Write data flow

```
form.email.value = "user@example.com"
  │
  ├─ 1. formatter(rawValue, allValues)    → normalized value
  ├─ 2. store value                       → nodeState updated, valuesCache O(1)
  ├─ 3. setter(value, allValues, prev)?   → patch → applied to sibling fields
  ├─ 4. recompute(changedNodes)           → targeted FieldState recompute
  ├─ 5. dirty flags                       → propagated up the tree
  ├─ 6. notify                            → version++ → useSyncExternalStore → re-render
  └─ 7. onChange                          → group onChange callback (fire-and-forget)
```

### Validation timing (`revalidate`)

Validation errors are hidden until the first failed `submit()` of the enclosing group. After that the group's `revalidate` flag turns `true` and `isInvalid` / `errorMessage` update live on every keystroke.

---

## API reference

### `new Palistor(options)`

```typescript
import { Palistor } from "palistor";

const store = new Palistor({
  config,          // ConfigNode tree — required
  initialValues,   // deep-partial values that override config defaults
  context,         // initial non-reactive context (see Store context)
  fieldMapping,    // prop renaming map (see Field mapping)
});
```

**Store — public API:**

| Property / method | Returns | Description |
|---|---|---|
| `store.proxy` | proxy | Reactive proxy mirroring the config. **Do not** pass it (or its subtrees) to `useForm` — pass the store itself |
| `store.getValues()` | values | Deep **clone** of all current values as a nested object |
| `store.submit()` | `Promise<SubmitResult>` | Submit the root group |
| `store.reset(values?)` | `void` | Reset to config defaults (or to the provided values) |
| `store.setValues(patch)` | `void` | Bulk patch: one recompute + notify; skips setters and formatters |
| `store.set(data)` | `void` | Upsert an entity or an array of entities in the registry |
| `store.delete(id)` | `void` | Remove an entity (cascades to child entities it owns) |
| `store.rekey(oldId, newId)` | `void` | Rename an entity in the registry and in every list |
| `store.invalidate(id, template?)` | `void` | Clear an entity's resolved cache so its resolve re-runs |
| `store.subscribe(node, fn)` | unsubscribe | Subscribe to one node's changes |
| `store.subscribeGlobal(fn)` | unsubscribe | Subscribe to all changes |
| `store.getVersion()` | `number` | Global version (incremented on every change) |
| `store.getNodeVersion(node)` | `number` | Version of a specific node |
| `store.setTranslator(fn \| null)` | `void` | Register an i18n function |
| `store.setNotifier(fn \| null)` | `void` | Register a notification function |
| `store.setContext(ctx)` | `void` | Merge non-reactive context (see Store context) |
| `store.context` | object | Current non-reactive context |
| `store.persist` | `PersistManager` | Persistence manager (`enable / disable / flush`) |

---

### `useForm(source)`

```typescript
import { useForm } from "palistor";

const form    = useForm(store);            // tracking proxy over the whole store
const section = useForm(form.address);     // independent tracking for a subtree (from a prop)
const entity  = useForm(item, (s) => s.editForm); // bind an entity to a template
```

Returns a typed tracking proxy. The component re-renders only when nodes it accessed change.

| Overload | When to use |
|---|---|
| `useForm(store)` | Root of a form; pass subtrees down as props |
| `useForm(subtreeProp)` | A large section with independent re-renders |
| `useForm(entityProxy, templateSelector)` | Render/edit a list entity through a template (binds on mount, unbinds on unmount) |

> ⚠️ Passing a raw `store.proxy` subtree (e.g. `useForm(store.proxy.address)`) is a **compile-time and runtime error**. Always go through `useForm(store)` first and drill into the returned proxy.

---

### Leaf node — proxy properties

```typescript
// Reads are reactive — they register the node in the tracking set
form.email.value          // → TValue
form.email.label          // → string | undefined
form.email.placeholder    // → string | undefined
form.email.description    // → string | undefined
form.email.isRequired     // → boolean
form.email.isReadOnly     // → boolean
form.email.isDisabled     // → boolean
form.email.isVisible      // → boolean
form.email.isInvalid      // → boolean | undefined
form.email.errorMessage   // → string | undefined
form.email.dirty          // → boolean
form.email.loading        // → boolean (per-field resolver)

// Writes trigger formatter → setter → recompute → notify
form.email.value = "new@example.com";
form.email.onValueChange("new@example.com"); // equivalent, handy as a callback prop

// A leaf can also be submitted on its own (runs the same pipeline)
form.email.submitting        // → boolean
await form.email.submit();   // → SubmitResult
```

### Group node — proxy properties

```typescript
form.passport.isVisible     // → boolean
form.passport.isRequired    // → boolean | undefined
form.passport.isReadOnly    // → boolean | undefined
form.passport.isDisabled    // → boolean | undefined
form.passport.isInvalid     // → boolean | undefined
form.passport.errorMessage  // → string | undefined
form.passport.submitting    // → boolean
form.passport.loading       // → boolean (async resolver in progress)
form.passport.dirty         // → boolean (at least one field changed)
form.passport.revalidate    // → boolean (true after the first failed submit)
form.passport.values        // → live snapshot of the group's values (stable reference)

await form.passport.submit();          // → SubmitResult
form.passport.reset({ number: "" });   // reset the subtree
form.passport.setValues({ number: "AB1234" }); // bulk patch, no setters/formatters
```

`values` is a live reference into the values cache: it is updated in place on every write, the reference itself stays stable — safe to hand to an API call. For a detached deep clone use `store.getValues()`.

---

### `ConfigNode` — field schema

```typescript
// Leaf node (has "value")
{
  value?: TValue | ((values: TValues) => TValue),   // static or computed
  validate?:  (value, values, t) => string | undefined | false,
  formatter?: (raw, values) => TValue,               // normalize on write
  setter?:    (value, values, previousValue) => DeepPartialValues<TValues>, // patch siblings
  beforeSubmit?: (value, groupValues) => TValue,     // transform before submit (no mutation)
  resolve?:   Resolve<TValue>,                       // per-field resolver (inside list templates)
  dependencies?: string[],                           // topological order for computed chains
  componentProps?: Record<string, unknown>,

  label?:       string | ((t, values) => string),
  placeholder?: string | ((t, values) => string),
  description?: string | ((t, values) => string),
  isVisible?:   boolean | ((values) => boolean),     // default: true
  isRequired?:  boolean | ((values) => boolean),     // default: false
  isDisabled?:  boolean | ((values) => boolean),     // default: false
  isReadOnly?:  boolean | ((values) => boolean),     // default: false
}

// Group node (no "value")
{
  beforeSubmit?: (values) => values,
  onSubmit?:     (values, store, parentProxy) => Promise<unknown> | unknown,
  afterSubmit?:  (result, { reset }) => void | Promise<void>,
  reset?:        (defaults) => values,               // transform on reset
  onChange?:     ({ fieldKey, newValue, previousValue, allValues }) => patch | void,
  resolve?:      Resolve,                            // async resolver (see below)

  isVisible?, isRequired?, isDisabled?, isReadOnly?, // same as leaf

  [childKey]: LeafNode | GroupNode | ListNode,       // children
}

// List node — array of length 1 or 2 (or use defineList)
[templateGroupNode]
[templateGroupNode, { resolve: { resolver, deps?, onError? } }]
```

### `SubmitResult`

```typescript
type SubmitResult =
  | { success: true;  result?: unknown }
  | { success: false; errors: Array<{ path: string; message: string }> };
```

### Recipes

```typescript
// Computed value
total: { value: (v) => v.price * v.quantity, isReadOnly: true },

// Computed chain — declare dependencies for topological ordering
tax:   { value: (v) => v.price * 0.2,   dependencies: ["price"] },
total: { value: (v) => v.price + v.tax, dependencies: ["price", "tax"] },

// formatter — normalize on write
email: { value: "", formatter: (v) => String(v).trim().toLowerCase() },

// setter — cascade changes to other fields
country: { value: "US", setter: (value) => ({ city: "" }) },

// group onChange — react to any field change inside the group
passport: {
  onChange: ({ fieldKey }) => {
    if (fieldKey === "number") return { issueDate: "" };
  },
  number:    { value: "" },
  issueDate: { value: "" },
},

// group submit with validation
company: {
  onSubmit: async (values) => api.saveCompany(values),
  afterSubmit: (_result, { reset }) => { showSuccessToast(); reset(); },
  name:  { value: "", isRequired: true },
  taxId: { value: "" },
},
```

---

## Async resolvers

A resolver is configured on a group node. It loads data asynchronously with auto-tracked dependencies, retry and React Suspense support.

```typescript
const store = new Palistor({
  config: {
    userId: { value: "" },

    userInfo: {
      resolve: {
        // `values` is a tracking proxy: every GET becomes a dependency.
        // When userId changes, the resolver re-runs automatically.
        // `store` gives access to the rest of the store (and store.context).
        resolver: async (values, store) => {
          const data = await api.getUser(values.userId);
          return { name: data.name, email: data.email };
        },

        // Instant placeholder while the resolver is running
        optimisticResolver: (values) => ({ name: "Loading…" }),

        onError: (error, ctx) => {
          ctx.notify("Failed to load user", "USER_LOAD_ERROR");
        },

        deps: ["userId"],            // explicit deps (used for the first run)
        contextDeps: ["accountId"],  // wait until store.context.accountId != null

        options: {
          lazy: true,      // wait for the first access to the node (default: true)
          suspense: false, // throw a promise for React Suspense (default: false)
          retry: { attempts: 3, delay: 1000 },
        },
      },

      name:  { value: "" },
      email: { value: "" },
    },
  },
});
```

```tsx
const form = useForm(store);

// Without Suspense — check loading manually
if (form.userInfo.loading) return <Spinner />;

// With Suspense — automatic
<Suspense fallback={<Spinner />}>
  <UserInfoSection />
</Suspense>
```

When a dependency changes, the resolve state resets, `optimisticResolver` applies instantly and the resolver re-runs. After success the dirty baseline is updated, so resolved data is not marked dirty.

---

## Lists & entities

Lists are declared with `defineList` (preferred — fully typed) or as a raw array of length 1–2 where `[0]` is the item template.

```typescript
import { defineList, Palistor } from "palistor";

interface User { id: string; name: string; email: string }

const users = defineList<User>({
  template: {
    id:    { value: "" },
    name:  { value: "", isRequired: true },
    email: { value: "" },
  },
  resolve: {
    resolver: async (values, store) => api.getUsers(values.filter), // → Promise<User[]>
    deps: ["filter"],
  },
});

const store = new Palistor({
  config: { filter: { value: "" }, users },
});
```

Items are stored in a **normalized entity registry**: the same entity can appear in multiple lists and be rendered through different templates without duplication.

### List proxy API

```typescript
const form = useForm(store);

// Read
form.users.items       // ReadonlyArray<entity proxy>
form.users.length      // number
form.users.loading     // boolean
form.users.dirty       // boolean — list membership changed vs. baseline
form.users.getValues() // Array<plain object>

// Iterate
form.users.map((item, index, id) => <Row key={id} item={item} />)
for (const item of form.users) { /* … */ }

// Mutate
form.users.add({ name: "Alice", email: "alice@ex.com" }); // object → upsert + append, returns the item proxy
form.users.add("existing-id");                            // string → append an existing entity
form.users.remove("user-id");
form.users.setItems(["id1", "id2", "id3"]);               // bulk replace
form.users.getById("user-id");                            // → item proxy | undefined
```

### List item — proxy properties

Every element of `form.users.items` is an entity projection through the template:

```typescript
const item = form.users.items[0];

item.id             // string — entity id
item.name.value     // field value through the template (formatter/validate/isRequired apply)
item.name.label     // computed label from the template
// …all leaf props: value, label, placeholder, isRequired, isReadOnly, isDisabled,
//   isVisible, isInvalid, errorMessage, dirty, loading, onValueChange

item.loading        // boolean — a resolve is running for this entity
item.submitting     // boolean — a submit is running for this entity
item.values         // plain object of the entity's current values
await item.submit(); // → SubmitResult — validates + onSubmit from the template
```

### Rendering an entity through another template

Bind an entity to any template group (e.g. an edit form) with the two-argument `useForm`:

```tsx
function UserRow({ user }: { user: PalistorRef<User> }) {
  const u = useForm(user, (s) => s.editUserForm);
  return <span>{u.name.value}</span>;
}
```

On mount the entity is bound to the template and the template's resolver runs once per entity+template pair (cached). Call `store.invalidate(id, template?)` to force it to run again.

### Working with entities directly

```typescript
// Create / update entities (single or batch — one recompute + notify)
store.set({ id: "u1", name: "Bob" });
store.set([{ id: "u1" }, { id: "u2" }]);

// If no id is provided, a temporary one is generated (_tmp_…).
// After the server assigns a real id:
store.rekey(tmpId, serverAssignedId);

// Remove an entity (children owned by it are removed in cascade)
store.delete("u1");
```

---

## Flows (step wizards)

`defineFlow` / `defineStep` build a step wizard on top of regular group nodes: navigation state, step statuses, branching and per-step validation.

```typescript
import { defineFlow, defineStep, Palistor } from "palistor";

const onboarding = defineFlow({
  steps: [
    defineStep("account", {
      fullName: { value: "", isRequired: true },
      email:    { value: "", isRequired: true },
      // Third onSubmit argument is the flow proxy — navigation methods are bound,
      // so destructuring works:
      onSubmit: (_values, _store, { nextStep }) => nextStep(),
    }),

    defineStep("plan", {
      plan: { value: "", isRequired: true },
      onSubmit: (_values, _store, { nextStep }) => nextStep(),
    }),

    // Branching: a hidden step is skipped by nextStep() and excluded from
    // final validation.
    defineStep("company", {
      isVisible: (values) => values.plan.plan === "enterprise",
      companyName: { value: "", isRequired: true },
      onSubmit: (_values, _store, { nextStep }) => nextStep(),
    }),

    defineStep("summary", {}), // read-only summary step
  ],

  // Flow-level finalization — runs through the standard submit pipeline
  onSubmit: async (allValues, store) => api.completeOnboarding(allValues),
});

const store = new Palistor({ config: { onboarding } });
```

### Flow proxy API

```tsx
const form = useForm(store);
const flow = form.onboarding;

// Navigation state (reactive)
flow.currentStepKey    // "account" | "plan" | …
flow.currentStepIndex  // number
flow.canGoBack         // boolean — visit stack is non-empty
flow.history           // readonly string[] — [...visitStack, currentStepKey]
flow.errors            // FlowError[] — from the last validate() / finalization

// Steps collection
flow.steps.current     // proxy of the active step
flow.steps.account     // by key
flow.steps[0]          // by index
flow.steps.length      // number of steps
[...flow.steps]        // iterable

// Step proxy = regular group proxy + status
flow.steps.account.status   // "active" | "completed" | null (not visited yet)
flow.steps.account.email    // field proxy — regular leaf

// Navigation
flow.nextStep();        // next VISIBLE step; if none ahead → finalize via flow.submit()
flow.back();            // pop the visit stack; no-op when empty
flow.goTo("plan");      // jump by key or index; throws on unknown key
flow.validate();        // validate visited visible steps → flow.errors

// Values & finalization
flow.values             // accumulated values of all steps, keyed by step
await flow.submit();    // standard pipeline; hidden steps' errors are filtered out
```

### Step lifecycle

A step config accepts two flow-specific callbacks in addition to everything a group supports:

```typescript
defineStep("details", {
  onEnter: (flowValues, store) => { /* fired on entering the step */ },
  onReady: (flowValues, store) => { /* fired after the step's resolve completes */ },
  resolve: { resolver: async (values, store) => api.getDetails(), onError: () => {} },
  // …fields
})
```

On entering a step: `onEnter → resolve (triggered eagerly) → onReady`. The first step of every flow is entered when the store is created. A step's resolve result is cached — re-entering does not re-run it. `reset()` of the flow (or any ancestor) resets navigation to the first step and re-runs the entry lifecycle.

Flow navigation (current step, history) is included in [persist](#persist) snapshots and restored on hydration.

---

## Field mapping

`fieldMapping` renames field-state props **at the proxy boundary** — GET, SET, tracking and spread — so `{...form.email}` can be spread directly into a component from MUI, Ant Design or plain HTML without adapters. The internal engine is unchanged.

```typescript
import { Palistor, defineFieldMapping, useForm } from "palistor";

// defineFieldMapping preserves the literal types so renamed props are
// statically typed on store.proxy / useForm(store).
const uiFieldMapping = defineFieldMapping({
  isRequired:   "required",
  isDisabled:   "disabled",
  isReadOnly:   "readOnly",
  isInvalid:    "error",
  errorMessage: "helperText",
  description:  "helpText",
});

const store = new Palistor({
  // The config is written in the SAME public vocabulary (external names).
  // Writing an internal name (isRequired) of a remapped key is a type error.
  config: {
    email: {
      value: "",
      label: "Email",
      required: true,
      helpText: "We never share your email",
      validate: (v: string) => (!v.includes("@") ? "Invalid email" : undefined),
    },
  },
  fieldMapping: uiFieldMapping,
});

function EmailField() {
  const form = useForm(store);
  return <TextField {...form.email} />; // required / error / helperText — as MUI expects
}
```

Mappable keys: `value`, `label`, `placeholder`, `description`, `isRequired`, `isReadOnly`, `isDisabled`, `isVisible`, `isInvalid`, `errorMessage`, `dirty`, `loading`, `onValueChange`. Without `fieldMapping` there is zero overhead and no behavior change.

> Use `defineFieldMapping` (or `as const`) for a reusable map — a plain `: FieldMapping` annotation or `satisfies FieldMapping` widens the literals to `string` and the static renaming is lost.

---

## Persist

Autosave form state to any storage.

### React hook (recommended)

```tsx
import { usePersist, localStorageDriver } from "palistor";

function PaymentPage({ orderId }: { orderId: string }) {
  usePersist(paymentStore, {
    key: `payment-${orderId}`,   // key may depend on props / router
    driver: localStorageDriver,
    debounce: 500,               // ms, default: 100
    pick: ["cardNumber"],        // persist only these top-level fields
    // omit: ["cvv"],            // …or exclude sensitive ones
  });

  const form = useForm(paymentStore);
  // …
}
```

The hook hydrates on mount, autosaves on change, and flushes + disables on unmount.

### Outside React

```typescript
import { localStorageDriver } from "palistor";

paymentStore.persist.enable({ key: "payment", driver: localStorageDriver });
await paymentStore.persist.flush();   // force save
paymentStore.persist.disable();
```

### Custom driver

Sync or async — both are supported (localStorage, IndexedDB, AsyncStorage, …):

```typescript
import type { PersistDriver } from "palistor";

const myDriver: PersistDriver = {
  getItem:    (key)        => myStorage.get(key),      // string | null | Promise<…>
  setItem:    (key, value) => myStorage.set(key, value),
  removeItem: (key)        => myStorage.delete(key),
};
```

**`PersistOptions`:**

| Option | Type | Default | Description |
|---|---|---|---|
| `key` | `string` | — | Storage key |
| `driver` | `PersistDriver` | — | Storage implementation |
| `debounce` | `number` | `100` | Write delay, ms (`0` = immediate) |
| `serialize` | `fn` | `JSON.stringify` | Custom serializer |
| `deserialize` | `fn` | `JSON.parse` | Custom deserializer |
| `pick` | `string[]` | — | Persist only these top-level keys |
| `omit` | `string[]` | — | Exclude these keys (ignored when `pick` is set) |

Persisted snapshots include list membership and flow navigation; both are restored on hydration.

---

## i18n

Register a translation function once — in a layout or provider. Every component using `useForm` gets translated `label` / `placeholder` / `description` automatically; changing the locale re-renders subscribed components.

```tsx
import { useTranslations } from "next-intl";
import { useTranslator } from "palistor";

function RootLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations();
  useTranslator(paymentStore, t);
  return <>{children}</>;
}
```

In the config, translatable strings are functions of `(t, values)`:

```typescript
cardNumber: {
  value: "",
  label:       (t) => t("fields.cardNumber"),
  placeholder: (t) => t("fields.cardNumber.placeholder"),
},
```

The `validate` callback also receives `t` as its third argument. Without a registered translator the functions receive an identity `t` — convenient for tests and SSR without an i18n environment.

---

## Notifications

Register a toast/alert function once; resolvers receive it in `onError` via `ctx.notify`:

```tsx
import { useCallback } from "react";
import { useNotifier } from "palistor";

function RootLayout({ children }: { children: React.ReactNode }) {
  const notifyError = useCallback((error: unknown, code?: string) => {
    addToast({ title: code ?? "Error", color: "danger" });
  }, []);

  useNotifier(paymentStore, notifyError);
  return <>{children}</>;
}
```

---

## Store context

Non-reactive data (account id, tenant, tokens…) available to every callback via `store.context`. It is not part of the form — it does not appear in `getValues()`, submit payloads or persisted state.

```tsx
import { useStoreContext } from "palistor";

function Layout({ children }) {
  const accountId = useAccountId();
  useStoreContext(store, { accountId }); // merges into store.context
  return <>{children}</>;
}
```

```typescript
resolve: {
  resolver: async (values, store) => api.fetchUsers(store.context.accountId),
  contextDeps: ["accountId"], // wait until context.accountId != null before the first run
},
```

Changing a context key re-triggers resolvers that depend on it (via `contextDeps` or a tracked `$context.…` path). You can also pass an initial context to the constructor: `new Palistor({ config, context: { accountId } })`.

---

## TypeScript

Palistor is fully typed — values, proxies, entities and even `fieldMapping` renames are inferred statically.

### Infer values from a config

```typescript
import type { ExtractValues, DeepPartialValues } from "palistor";

const config = {
  name:    { value: "" },
  age:     { value: 0 },
  address: { city: { value: "" }, country: { value: "US" } },
};

type FormValues = ExtractValues<typeof config>;
// → { name: string; age: number; address: { city: string; country: string } }

const initial: DeepPartialValues<FormValues> = { address: { city: "Berlin" } };
```

### Type child-component props without importing the config

`PalistorProxy<T>` maps a plain values interface onto the proxy tree (the type is named `PalistorProxy` because the value `Palistor` is the store class):

```typescript
import type { PalistorProxy } from "palistor";

interface UserData { name: string; email: string; address: { city: string } }

function UserForm({ user }: { user: PalistorProxy<UserData> }) {
  const u = useForm(user);
  return <input value={u.name.value} onChange={(e) => (u.name.value = e.target.value)} />;
}
```

### Typed entity references

```typescript
import type { PalistorRef, PalistorList, InferEntity } from "palistor";

interface User { id: string; name: string }

function UserRow({ user }: { user: PalistorRef<User> }) {
  const u = useForm(user, (s) => s.editUserForm);
  return <span>{u.name.value}</span>;
}

type UserEntity = InferEntity<PalistorRef<User>>; // → User
type UsersList  = PalistorList<User>;             // typed list proxy
```

### Type reference

| Type | Purpose |
|-----|-----|
| `ExtractValues<TConfig>` | Values type inferred from a config |
| `ConfigProxy<TConfig>` | Full proxy type — what `useForm(store)` returns |
| `PalistorProxy<T>` | Proxy built from a plain values interface — for child-component props |
| `PalistorRef<TEntity>` | Opaque entity reference — for single-item props |
| `PalistorList<TEntity>` | Typed list proxy |
| `InferEntity<T>` | Extract the entity type from a `PalistorRef` |
| `FieldMapping` / `defineFieldMapping` | Prop renaming map (preserves literals) |
| `FlowProxyNode<S>` / `FlowStepProxy<C>` / `StepStatus` | Flow proxy types |
| `MaybeComputed<TResult, TValues>` | Constant or `(values) => T` — `isVisible`, `isRequired`, `value` |
| `MaybeTranslatable<TResult, TValues>` | Constant or `(t, values) => string` — `label`, `placeholder` |
| `DeepPartialValues<T>` | Deep-partial values: `initialValues`, `setter` patches, `setValues` |
| `TranslateFn` | Compatible with next-intl `t`, i18next `t`, any `(...args) => string` |
| `TemplateConfig<TEntity>` / `ListResolver<TEntity>` | Typed list template / resolver |
| `PersistDriver` / `PersistOptions` | Persistence contracts |
| `Resolve<T>` / `NotifyFn` / `ResolveErrorContext` | Resolver contracts |

---

## License

[MIT](./LICENSE) © Yuri Palienko
