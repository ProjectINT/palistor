# Palistor

> A declarative MVVM-like framework for React — AI-friendly, forms, lists and step wizards.

**English** | [Русский](./README.ru.md)

[![npm version](https://img.shields.io/npm/v/palistor.svg)](https://www.npmjs.com/package/palistor)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![react](https://img.shields.io/badge/react-%5E19-61dafb.svg)](https://react.dev)

**Palistor is a declarative MVVM-like framework for stateful, data-driven React interfaces.**

Palistor splits the frontend into three layers:

1. The view layer. This is the JSX layer, stripped of everything except the actual rendering. By rendering here we mean markup, layout and styles.

A markup example (View in MVVM terms):
```tsx
function Form() {
  const form = useForm(store);

  return (
    <Input
      {...form.email}
    />
    {form.phone.isVisible && (
      <Input
        {...form.phone}
      />
    )}
  );
}
```

2. The configuration layer.

A configuration example (ViewModel declaration in MVVM terms):

```ts
const store = new Palistor({
  config: {
    id: { value: "" },
    email: {
      value: "",
      isRequired: true,
    },
    phone: {
      value: "",
      isVisible: (v) => v.email !== "",
      resolve: {
        resolver: async (v) => { return await getPhone(v.id) } // getPhone is already the data layer.
      }
    },
  },
});
```

3. The data layer (Model). This is the layer responsible for fetching and sending data. The data layer can be anything — a plain resolver, or a complex caching layer implementing offline functionality. Palistor doesn't impose a data-layer implementation; it only provides the interface to integrate one.
Palistor's state also caches data so it isn't re-fetched from the data layer unnecessarily.

---

## Table of contents

- [Idea](#idea)
- [Demo](#demo)
- [Features](#features)
- [Installation](#installation)
- [Agent Skills](#agent-skills)
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
- [SSR & Next.js](#ssr--nextjs)
- [TypeScript](#typescript)
- [License](#license)

---

## Idea

### The MVVM idea (Model-View-ViewModel)

#### Classic MVVM, but by data flow it's more accurate to read it as a pipeline: Model → ViewModel → View

Most React screens tangle three unrelated concerns inside components:
 - how the screen **behaves** (validation, conditional fields, cross-field rules),
 - where its **data** comes from (loading, caching, mutations),
 - and how it **looks** (JSX).
As the screen grows, these three parts braid together until any change touches everything. On top of that, the complexity of dependencies, useEffects, custom hooks and contexts keeps growing — and the screen ends up monolithic, unpredictable and hard to test.

This all worked fine as long as we wrote the code by hand — we'd learned to write reasonably good React, and even though sometimes a single button took 3 components and a couple of hooks, we had the time and the means to decompose the complexity and manage it effectively.

But today we increasingly don't want to read the code we get from AI — we're losing control. In some systems that loss of control is acceptable enough: "well, it works", e2e tests to the rescue.

AI is bad at architecture, but it's great at filling declarative slots. Palistor removes the architecture task itself — all that's left is filling in the config by the rules. That's why generated code can't fall apart: there's nowhere to go wrong, and reviewing it means reviewing one flat object instead of a tree of useEffects.

If you look at Palistor's code examples, you'll notice the complexity is decomposed in such a way that it doesn't exist anywhere else. More precisely, there's no excessive complexity — all the necessary complexity is pulled into the config.
  - The View is so primitive there's nowhere to make a mistake.
  - The ViewModel (or, more precisely, the ViewModel declaration) is just an object with behavior, expressing the logic in the simplest, most compact way possible.
  - The Model is outside Palistor's responsibility: any data source (a plain `fetch`, a caching layer, or an offline layer) that you plug in via `resolve`. Palistor only defines the interface to it, not the implementation.

We can generate any frontend by Palistor's rules without losing control.
As a bonus, we get:
 - instant reconfiguration for different modes. In today's world we'll have to configure apps for different regions, laws and rules, and easily adding new modes and contexts becomes a real advantage.
 - simple state debugging. Thanks to this separation, all the relationships between data are visible at a glance. There's simply nowhere to get lost.
 - React becomes a thin rendering layer — no more useEffect and no more complex rules and subtleties tied to React's core and its rendering model.
 - State is computed in the store, outside React's render cycle; a component only gets a signal for the fields it actually read → targeted re-renders instead of cascading ones.
 - Better code organization, and more natural reuse of things like validators, formatters, and other helpers.

All of this lets us grow the complexity of every layer and add new functionality without sacrificing stability or predictability. And, most importantly, move toward generating frontends for enterprise systems.

### Use cases for Palistor

Admin panels, SaaS platforms, consoles, personal dashboards — anything built mostly from forms, step wizards, dynamic widgets and tables:
 - Onboarding / KYC / verification / questionnaires — branching multi-step wizards, conditional fields, step-by-step validation (`defineFlow`).
 - Checkouts and payment forms — conditional payment methods, cross-field rules, async loading.
 - Configurators / calculators / CPQ — computed fields and dependencies (price×quantity→tax→total) without a single useEffect.
 - Reference-data-driven forms — dependent selects (country→city), options via `resolve`.
 - CRUD entity editors and tables with inline editing — a normalized registry, list proxy, per-entity templates.
 - Schema-driven / backend-driven forms — since the config is data, it can be generated or served from the backend. Plus the multi-region angle: context for regions/laws.
 - Dashboards with form-like filters — a filter panel as a reactive data source.

### What Palistor is not for

Landing pages with no complex logic, where the main goal is to ship a simple page fast.
 - Content sites: blogs, docs, marketing, SSG — SEO-first, static, almost no behavior.
 - Graphics / canvas / realtime rendering — games, editors (rich text, diagrams, maps), video players, heavy visualizations. Here the complexity lives in rendering, and the model doesn't split into layers.
 - Trivial UI — a single search box, one button, a form with a couple of fields: the three-layer split is overhead that doesn't pay off.
 - Embeddable widgets where bundle size is critical — the library isn't small, which is a downside for an embeddable script on someone else's page.

---

## Demo

A live playground with every example from this README: **[projectint.github.io/palistor](https://projectint.github.io/palistor/)**

Each tab is a separate framework feature, and every one has a direct deep link:

- [Quick start](https://projectint.github.io/palistor/#form) — conditional fields, submit pipeline, persist
- [Flows](https://projectint.github.io/palistor/#flow) — a step wizard with branching
- [Lists & entities](https://projectint.github.io/palistor/#lists) — normalized registry, list proxy, store context
- [Async resolvers](https://projectint.github.io/palistor/#async) — data loading, retry, notifications
- [Field mapping](https://projectint.github.io/palistor/#mapping) — rename props to your UI kit

The playground sources live in [`app-demo/`](https://github.com/ProjectINT/palistor/tree/main/app-demo). Each section below links to the specific example code and its live tab.

---

## Features

The feature set aims to cover every typical need of a modern frontend — forms, lists, step wizards.

Palistor's philosophy is to provide a complete toolkit for generating any frontend, using all the best and most traditional practices.

| | |
|---|---|
| **Granular re-renders** | A component subscribes only to the fields it read — nothing else triggers a re-render |
| **Computed field state** | `isVisible`, `isRequired`, `label`, validation errors are recomputed automatically from the config |
| **Proxy API** | Native syntax: `form.email.value = x` instead of dispatching actions |
| **Submit pipeline** | `beforeSubmit → validate → onSubmit → afterSubmit`, errors surface after the first failed submit |
| **Dirty tracking** | Per-field and per-group change flags; the baseline updates after resolve and reset |
| **Async resolvers** | Data loading with auto-tracked dependencies, retry, optimistic updates and React Suspense |
| **Lists & entities** | Normalized entity registry, list proxy with `add / remove / setItems`, per-entity templates |
| **Pagination** | Page-level cache — a cached page switch never calls the resolver; `paged` / `infinite` / `cursor` modes, persisted windows, nested lists |
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

## Agent Skills

Palistor ships its own instructions for AI coding agents: five [Agent Skills](https://agentskills.io) inside the npm package (`node_modules/palistor/skills/`), versioned together with the code they describe. An agent that loads them writes configs by the rules of the version you have installed instead of guessing.

**Recommended — [TanStack Intent](https://tanstack.com/intent/latest):**

```bash
npm i palistor
npm i -D @tanstack/intent
npx @tanstack/intent@latest install   # interactive: choose palistor
```

`intent install` saves your choice in `package.json#intent.skills` and adds a block to `AGENTS.md` (or to the agent instruction file the project already has) that tells the agent to run `intent list` and `intent load palistor#<skill>` before it edits code. Claude Code reads `AGENTS.md` by itself from v2.1.277; on an older version put `@AGENTS.md` into `CLAUDE.md`, or use the plugin below.

**Alternatives** — install the skills straight from this repository:

```bash
# Claude Code plugin (run inside Claude Code)
/plugin marketplace add ProjectINT/palistor
/plugin install palistor@palistor

# skills CLI
npx skills add ProjectINT/palistor --full-depth --skill palistor palistor-lists palistor-flows palistor-field-mapping palistor-ssr

# GitHub CLI
gh skill add ProjectINT/palistor skills/palistor/SKILL.md
gh skill add ProjectINT/palistor skills/palistor-lists/SKILL.md
gh skill add ProjectINT/palistor skills/palistor-flows/SKILL.md
gh skill add ProjectINT/palistor skills/palistor-field-mapping/SKILL.md
gh skill add ProjectINT/palistor skills/palistor-ssr/SKILL.md
```

| Skill | Teaches |
|---|---|
| `palistor` | The core, start here: config → store → `useForm` → spread; fields and groups, validation, visibility, computed values, submit and reset, async `resolve`, persist, i18n |
| `palistor-lists` | Collections: `defineList`, loading / error / reload, adding and removing rows, temporary ids, editing one entity, filtering, pagination |
| `palistor-flows` | Step wizards: `defineFlow` / `defineStep`, navigation, branching, per-step and final validation |
| `palistor-field-mapping` | UI kits: one adapter component per input kind, `fieldMapping` to rename field props |
| `palistor-ssr` | Server rendering in Next.js (App Router): `usePalistor`, `PalistorProvider`, `initialData`; data and translations in the first HTML, no store requests on the server, no refetch after hydration |

The skills are updated together with the package: `npm update palistor` also brings the instructions for the new version. The repository installs above follow the default branch, not your installed version.

---

## Quick start

> 🔗 **Source:** [config/payment.ts](https://github.com/ProjectINT/palistor/blob/main/app-demo/src/config/payment.ts), [modules/payment-form/](https://github.com/ProjectINT/palistor/tree/main/app-demo/src/modules/payment-form) · **Live result:** [Demo → Payment Form](https://projectint.github.io/palistor/#form)

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
          {...form.cardNumber} // The config knows the Input's interface thanks to an adapter (fieldMapping)
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
      <Input {...p.number} />
      <Input {...p.issueDate} />
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
  translator,      // i18n function, in place from the first render (see i18n)
  notifier,        // notification function behind ctx.notify (see Notifications)
  initialData,     // resolver results the server already has, in the shape of getValues() (see SSR & Next.js)
  server,          // server mode: the store starts nothing by itself;
                   // default: typeof window === "undefined" (see SSR & Next.js)
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
| `store.start()` | `void` | Run what the store starts by itself: flow step entry, eager resolvers, every resolver already read. The constructor of `new Palistor()` calls it outside server mode; for a `usePalistor` store the hook calls it after the first commit. Idempotent (see SSR & Next.js) |

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

### `usePalistor(options)`

```tsx
import { usePalistor } from "palistor";

const store  = usePalistor({ config, context: { accountId } });             // options object
const wizard = usePalistor(() => ({ config: buildConfig(), initialData })); // function: called once
```

Creates one store per component instance and returns the same store on every render. Takes the options of `new Palistor(options)` and merges the values of the nearest `<PalistorProvider>` into them:

| Option | What the store gets |
|---|---|
| `context` | `{ ...providerContext, ...options.context }` — the store's own keys win |
| `translator`, `notifier` | The option when given, the provider's otherwise |

After mount the hook follows only these three and pushes a change with `store.setContext` / `setTranslator` / `setNotifier`: from the provider always, from the options only when they are passed as an object (a function has been read once). The context is merged per key: a key that disappears keeps its last value in the store — pass it as `undefined` to clear it. `config`, `initialValues`, `initialData`, `fieldMapping` and `server` are read once; a component that must start over with new data needs a new `key`. Unmount resets nothing: the store goes with the component.

Nothing starts during a render. The store is built held, and an effect calls `store.start()` once the component has committed: the flows enter their first step, the eager resolves start, and so does every resolve the render read. Until then those read `loading: true` (a list also reads `resolveStatus: "idle"`) — what the server's HTML shows, so the first client render matches it. What a child's effect asks of the store before that — a `reload()`, for example — is not lost: the start runs it. With `server: true` in the options the hook does not start the store at all: `store.start()` is yours to call. A store made with `new Palistor()` is not held: in the browser its constructor starts it.

Under `<StrictMode>` in development React renders the component twice and mounts its effects twice, but one store is built: the options function is called once, and an eager resolver or a flow's first `onEnter` starts once (`start()` does nothing the second time). A render that React discards before commit — a transition render restarted because another store changed under it, or a component that suspends before its first commit — drops its store, and that store has requested nothing: only the committed instance's store starts.

### `<PalistorProvider>` / `usePalistorContext()`

```tsx
import { PalistorProvider, usePalistorContext } from "palistor";

<PalistorProvider context={{ account, navigate }} translator={t} notifier={notifyError}>
  {children}
</PalistorProvider>

const { account } = usePalistorContext<{ account: Account }>(); // any component below
```

| Prop | Description |
|---|---|
| `context` | Merged into `store.context` of every `usePalistor` store below; a store's own `context` option wins per key |
| `translator` | Translation function of the stores below that are not given their own |
| `notifier` | Notification function (`ctx.notify`) of the stores below that are not given their own |

All props are optional. Nested providers add up: the inner `context` is merged over the outer one (shallow, the inner key wins), and a `translator` / `notifier` the inner provider does not pass is inherited. The context is compared per key, so an inline `context={{ … }}` with the same values is not a change — keep the values themselves stable. The provider reaches only stores created with `usePalistor`; a store made with `new Palistor()` is wired with `useStoreContext` / `useTranslator` / `useNotifier`.

`usePalistorContext<T>()` returns the provider's merged `context`. It is a plain React context read: the component re-renders when a key changes. It is the provider's value, not a store's — a store's own `context` option and later `setContext` calls are in `store.context`. Without a provider it returns an empty object; `T` is not checked against what the provider was given.

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
form.passport.loading       // → boolean (async resolver in progress or about to start)
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

> 🔗 **Source:** [config/catalog/](https://github.com/ProjectINT/palistor/tree/main/app-demo/src/config/catalog), [modules/async-demo/](https://github.com/ProjectINT/palistor/tree/main/app-demo/src/modules/async-demo) · **Live result:** [Demo → Async resolvers](https://projectint.github.io/palistor/#async)

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

        // `notify` is the store's notifier, `t` its translator: the message is built here, without a hook
        onError: (error: unknown, { notify, t }: { notify: NotifyFn; t: TranslateFn }) => {
          notify(t("errors.loadUser"), "USER_LOAD_ERROR");
        },

        deps: ["userId"],            // explicit deps (used for the first run)
        contextDeps: ["accountId"],  // wait until store.context.accountId != null

        options: {
          lazy: true,      // wait for the first read of the node, `loading` included (default: true)
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

`loading` is `true` while the resolver runs and also while its first run is about to start: for an eager resolver (`lazy: false`) from the moment the store is created, for a lazy one from the first read of the node. Reading `loading` is such a read, so `if (form.userInfo.loading) return <Spinner />` shows the spinner in the very first render. A store created with `usePalistor` starts its runs after the component's first commit: until then they are about to start, and `loading` is already `true`. A resolver that still waits for its `contextDeps` reads `loading: false`. On the server no resolver runs, and a `suspense: true` node sends the fallback of its boundary — see [SSR & Next.js](#ssr--nextjs).

When a dependency changes, the resolve state resets, `optimisticResolver` applies instantly and the resolver re-runs. After success the dirty baseline is updated, so resolved data is not marked dirty.

`onError(error, { notify, t })` gets the error and a context. `notify` calls the store's notification function (see [Notifications](#notifications)). `t` is the store's current translator — the one given to the constructor, to `<PalistorProvider>`, to `store.setTranslator` or to `useTranslator`: a stable reference that follows a later `setTranslator` and returns the key when no translator is registered. So an error message is built in the config, without a hook. The declared context type gets `t` in 0.1; until then annotate the parameter as above (`NotifyFn` and `TranslateFn` are exported types; see [Type reference](#type-reference)).

---

## Lists & entities

> 🔗 **Source:** [modules/lists-demo/](https://github.com/ProjectINT/palistor/tree/main/app-demo/src/modules/lists-demo) · **Live result:** [Demo → Lists & entities](https://projectint.github.io/palistor/#lists)

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
form.users.items         // ReadonlyArray<entity proxy>
form.users.length        // number
form.users.loading       // boolean
form.users.dirty         // boolean — membership changed vs. baseline, here or in a nested list
form.users.error         // unknown | null — error thrown by the last resolve
form.users.resolveStatus // "idle" | "pending" | "resolved" | "error"
form.users.getValues()   // Array<plain object>

// Re-run the resolver (ignores the resolved-state dedup; no-op without a resolver)
form.users.reload();

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

A list is `dirty` by composition: its membership differs from the loaded one, or a row of it owns a nested list that is dirty the same way, at any depth. So `add` / `remove` / `setItems` inside a nested list makes dirty the nested list, the row that owns it, the list that row belongs to, and the form (`form.dirty`). A row's field values take no part: editing a field makes the row dirty, not the list. `store.reset()` clears `dirty` along the whole chain. A successful `submit()` alone moves no baseline, for any kind of node: the chain is clean after `afterSubmit: (_result, { reset }) => reset()`, after `store.reset()`, or after the nested list's `reload()`.

### Resolve state: loading / error / reload

`loading`, `error` and `resolveStatus` are projections of one resolve state, so they are always
coherent — and reactive: a component reading `error` re-renders when it appears and when it clears.

```tsx
function Users() {
  const form = useForm(store);
  const users = form.users;

  if (users.error) return <LoadError onRetry={() => users.reload()} />;
  if (users.loading) return <Spinner />;

  return <ul>{users.map((u, i, id) => <li key={id}>{u.name.value}</li>)}</ul>;
}
```

`loading` is `true` while a run is in flight and also from the first read of the list until its
first run starts. Reading `loading` is itself such a read — it wakes the lazy resolver like `items`
does — so the component above renders the spinner in its very first render, on the server too (see
[SSR & Next.js](#ssr--nextjs)). `resolveStatus` stays `"idle"` until the run really starts.

`reload()` re-runs the resolver even after a successful load, but never spawns a parallel run while
one is in flight. Its identity is stable, so it is safe in a deps array or an `onRetry` prop. Works
the same for root lists and per-entity nested lists.

> **Groups don't expose `error` yet.** A group/flow resolver's failure is still reachable only
> through its `onError` callback; `error` / `resolveStatus` / `reload()` are list-only for now.

> **These three keys are not `fieldMapping`-mappable.** They are matched before the mapping is
> applied, so a mapping such as `{ isInvalid: "error" }` does not shadow them: on a **field** `.error`
> stays the validation flag, on a **list** `.error` is the resolve error. The two never coexist on
> one node.

### Pagination

> 🔗 **Source:** [modules/lists-demo/OrdersPagedSection.tsx](https://github.com/ProjectINT/palistor/tree/main/app-demo/src/modules/lists-demo/OrdersPagedSection.tsx) · **Live result:** [Demo → Lists & entities](https://projectint.github.io/palistor/#lists)

A list fetches **one page at a time** and caches every page it has seen. Add a `pagination` block to
`resolve` — its presence is the only switch. The resolver gets the page request as `ctx.page` and
returns `{ items, total }` (a bare array still works — `total` is then derived from the loaded pages).

```typescript
const orders = defineList<Order>({
  template: { id: { value: "" }, title: { value: "" }, amount: { value: 0 } },
  resolve: {
    deps: ["search"],                       // seeds the query key before the first run
    pagination: { pageSize: 20 },           // mode: "paged" (default) | "infinite" | "cursor"
    resolver: async (values, store, ctx) => {
      const r = await api.orders({
        q: values.search,                   // every value / context read is an auto-dep
        tenant: store.context.tenantId,
        offset: ctx.page!.offset,           // (page − base) × pageSize
        limit: ctx.page!.pageSize,
        cursor: ctx.page!.cursor,           // cursor / infinite modes
      });
      return { items: r.rows, total: r.count, nextCursor: r.next }; // PagedResult
    },
  },
});
```

**Switching to a page that is already cached never calls the resolver** — it is a synchronous
projection. Only a miss, a stale page or a change in what the resolver read (search, filters,
`store.context`, …) does: that is a new *query key*, so the old pages are invalidated and page 1 is
fetched exactly once. The same values written back unchanged are a strict no-op.

```typescript
const list = form.orders;

// Reactive getters (a Pager reading only page / pageCount re-renders on setPage)
list.page            // current page (honors `base`, default 1)
list.pageSize
list.pageCount       // from the server total, else the number of contiguous cached pages
list.total           // DISPLAY total: server total ± local optimistic adds/removes
list.serverTotal     // raw server total — moves only on fetch / delete / confirmed add
list.hasNextPage     // never fooled by an optimistic add
list.hasPrevPage
list.isFetching      // any page fetch in flight (`loading`: this, or the first fetch about to start)
list.isInitialLoading // fetching, or about to fetch, with nothing cached yet — skeleton vs. spinner;
                     // reading it wakes the lazy list, as `loading` and `items` do
list.isPreviousData  // `keepPreviousData`: the rows on screen belong to the previous query
list.pendingAdds     // ids of un-flushed optimistic adds (restored from storage or not)

// Navigation
list.setPage(n);     // cached & fresh → synchronous; otherwise one fetch
list.nextPage();  list.prevPage();
list.prefetch(n);    // warm the cache without moving the pointer (hover)
list.setPageSize(n); // clears the cache, fetches page 1 once

// Freshness — always at most ONE request
await list.refetch();   // paged: the whole query goes stale, the current page refetches now;
                        // infinite / cursor: pull-to-refresh — back to the first page
list.invalidate();      // mark every page stale; the current one refetches now
list.invalidate(3);     // one page (cursor / infinite: every page after it is dropped too)
list.discardPendingAdds(); // drop un-flushed optimistic rows (escape from a permanently dirty list)

// infinite mode only
list.loadMore();            // append the next page (cache hit ⇒ no fetch; no-op while one is in flight)
list.isFetchingNextPage     // a footer spinner, distinct from isInitialLoading
list.loadedPages            // [{ ordinal, ids }] — for section-header UIs
list.continuationLost       // cursor chain could not be rebuilt → offer "Reload feed"
```

```tsx
function Orders() {
  const form = useForm(store);
  const orders = form.orders;
  return (
    <>
      {orders.isInitialLoading ? <Skeleton /> : orders.map((o, i, id) => <Row key={id} order={o} />)}
      <button disabled={!orders.hasPrevPage} onClick={orders.prevPage}>Prev</button>
      <span>Page {orders.page} of {orders.pageCount}{orders.isFetching && " …"}</span>
      <button disabled={!orders.hasNextPage} onClick={orders.nextPage}>Next</button>
    </>
  );
}
```

**Modes.** `paged` — one page on screen, random access. `infinite` — the window accumulates
(`loadMore`); the continuation runs off `nextCursor` when the resolver returns one, else off the
offset. `cursor` — one page on screen, sequential access through `nextCursor` (`prevPage` is free,
`setPage(n)` reaches only the next ordinal).

**The end of a feed.** In `infinite` and `cursor` modes a page returned with an explicit
`nextCursor: null` is the last one: `hasNextPage` is `false`, `loadMore()` and `nextPage()` request
nothing, and in `cursor` mode neither do `setPage(next)` and `prefetch(next)`. The explicit `null` wins
over `total`, over `hasMore: true` and over a full page. A page without the field says nothing about
the end: `total`, `hasMore` or a full page decide. So a feed that continues by offset must omit
`nextCursor`, not send `null`. A first page given as `initialData` (`{ items, nextCursor: null }`)
follows the same rule.

**Local edits vs. the cache.** `add / remove / setItems` mutate the cached page they land on; the
visible window is always a projection of the pages. `dirty` is the aggregate over every cached page,
so an un-flushed add parked on an off-screen page keeps the list dirty, and so does an edit in a
nested list of a row on such a page. `reset()` rolls back the edits
of every cached page and keeps the navigation (no request). `store.rekey(tmp, real)` reaches every
cached page and promotes the confirmed row into server truth; `store.delete(id)` splices it out of
every page and shifts the later ones stale. A deleted row on a `paged` list is replaced on screen by
the head of the next cached page until that page is refetched.

| `pagination` option | Default | Meaning |
|---|---|---|
| `pageSize` | — | required |
| `mode` | `"paged"` | `"paged"` \| `"infinite"` \| `"cursor"` |
| `base` / `initialPage` | `1` / `base` | page numbering |
| `staleTime` | `Infinity` | ms a cached page is served without a background refetch (stale-while-revalidate) |
| `maxCachedQueries` / `gcTime` | `1` / `Infinity` | how many query keys are retained (flip back to an old filter ⇒ cache hit) and for how long |
| `maxCachedPages` | `Infinity` | LRU cap on cached pages per query (the visible window is never evicted) |
| `maxPages` | `Infinity` | `infinite`: the window keeps at most this many pages — the oldest leave memory, the continuation offset survives |
| `keepPreviousData` | `false` | keep the previous query's rows on screen while page 1 of the new one loads |
| `persist` | `{ maxPages: 3 }` | what reaches storage: a bounded tail, `"window"` (everything + the scroll anchor), or `false` |
| `persistPendingAdds` | `"keep"` | un-flushed optimistic adds survive a reload (`"drop"` to discard) |
| `revalidateOnHydrate` | `"first"` | what a restored, expired window revalidates after paint (`"none"` \| `"first"` \| `"all"`) |
| `queryKey(values, context)` | auto | escape hatch when the auto-tracked dependency values are not serializable |

**Persist.** With `usePersist` / `store.persist` the current page (and, for `infinite`, the tail of the
window) is restored on reload and served without a request — but only when the saved query still
matches the live values and context (a window saved for tenant A is never served to tenant B). With
`persist: "window"` call `list.setScrollAnchor(id)` from an IntersectionObserver and read
`list.scrollAnchor` after hydrate to restore the scroll position.

**Nested lists.** The same `pagination` block on a list inside an entity template paginates **each
per-entity instance independently** (`user.orders.setPage(2)`), with its own cache and query key. The
resolver receives the owner's values as the first argument — the owner fields it reads become its
dependencies, so editing `user.region` re-keys only that user's list.

**Suspense.** `resolve.options.suspense: true` makes `items` / `map` / `length` throw the in-flight
promise while the list has nothing to render (the first page, or a query change without
`keepPreviousData`); a page navigation or `loadMore` never suspends the rows already on screen.

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

**Nested lists.** A list declared inside a template is a per-entity list: every row owns its own instance, read from the row (`item.orders`) through the same list proxy API. A nested list gets its rows from its own resolver, from `setItems` / `add`, or from `initialData`. The resolver of the list above does not fill it: a nested array inside a row that a resolver returns is not the nested list's membership. `initialData` and a persisted draft do fill nested lists from the rows (see [SSR & Next.js](#ssr--nextjs)).

**`store.reset()` and rows.** A full `store.reset()` requests nothing for rows. A nested list and a row field whose resolve has its result stay resolved: the list's membership returns to what the resolver (or `initialData`) loaded, `loading` is `false`, and the next read does not call the resolver — as with a root list. The reset also reaches the nested lists of rows that are off screen (on another cached page of a paginated list). A resolve that was in flight or had failed when the reset came starts over on its next read. To fetch a nested list again on purpose, call its `reload()`.

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

> 🔗 **Source:** [config/flow.ts](https://github.com/ProjectINT/palistor/blob/main/app-demo/src/config/flow.ts), [modules/flow-demo/](https://github.com/ProjectINT/palistor/tree/main/app-demo/src/modules/flow-demo) · **Live result:** [Demo → Flows](https://projectint.github.io/palistor/#flow)

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

On entering a step: `onEnter → resolve (triggered eagerly) → onReady`. The first step of every flow is entered when the store starts: in the constructor for `new Palistor()`, after the component's first commit for `usePalistor`. Until then — and in server mode, where nothing starts — no callback is called, and a first step with `resolve` reads `loading: true` (see [SSR & Next.js](#ssr--nextjs)). A step's resolve result is cached — re-entering does not re-run it. `reset()` of the flow (or any ancestor) resets navigation to the first step and re-runs the entry lifecycle.

Flow navigation (current step, history) is included in [persist](#persist) snapshots and restored on hydration.

---

## Field mapping

> 🔗 **Source:** [config/fieldMapping.ts](https://github.com/ProjectINT/palistor/blob/main/app-demo/src/config/fieldMapping.ts), [modules/field-mapping/](https://github.com/ProjectINT/palistor/tree/main/app-demo/src/modules/field-mapping) · **Live result:** [Demo → Field mapping](https://projectint.github.io/palistor/#mapping)

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

> 🔗 **Source:** [modules/payment-form/PersistControls.tsx](https://github.com/ProjectINT/palistor/blob/main/app-demo/src/modules/payment-form/PersistControls.tsx) · **Live result:** [Demo → Payment Form](https://projectint.github.io/palistor/#form)

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

The `validate` callback also receives `t` as its third argument. Without a registered translator the functions receive an identity `t`, so a label function returns its key — convenient for tests.

A resolver's `onError` gets `t` too, in its context next to `notify`, so an error message is translated in the config, without a hook:

```typescript
userInfo: {
  resolve: {
    resolver: async () => api.getUser(),
    onError: (error: unknown, { notify, t }: { notify: NotifyFn; t: TranslateFn }) =>
      notify(t("errors.loadUser")),
  },
  name: { value: "" },
},
```

This `t` is the store's current translator and follows a later `store.setTranslator`. `NotifyFn` and `TranslateFn` are types exported by the package; [Notifications](#notifications) explains why the parameter is annotated.

`useTranslator` registers the function in an effect, after mount: the server HTML and the first client render do not have it yet. To translate from the first render, give the function to the constructor — `new Palistor({ config, translator: t })` — or to `<PalistorProvider translator={t}>`, which hands it to every store created with `usePalistor` below (see [SSR & Next.js](#ssr--nextjs)). `useTranslator` stays as it is and applies after mount.

---

## Notifications

> 🔗 **Source:** [config/catalog/catalog.ts](https://github.com/ProjectINT/palistor/blob/main/app-demo/src/config/catalog/catalog.ts) · **Live result:** [Demo → Async resolvers](https://projectint.github.io/palistor/#async)

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

`onError` gets the function in its context, together with the store's translator `t`:

```typescript
import { defineList, type ResolveErrorContext, type TranslateFn } from "palistor";

interface User { id: string; name: string }

const users = defineList<User>({
  template: { id: { value: "" }, name: { value: "" } },
  resolve: {
    resolver: async () => api.getUsers(),
    onError: (error: unknown, ctx: ResolveErrorContext) => {
      const { notify, t } = ctx as ResolveErrorContext & { t: TranslateFn }; // the declared type gets `t` in 0.1
      notify(t("errors.loadUsers"), "USERS_LOAD_ERROR");
    },
  },
});
```

`notify` passes its arguments to the registered function. `t` is the store's current translator — the one given to the constructor, to `<PalistorProvider>`, to `store.setTranslator` or to `useTranslator`. It is a stable reference that follows a later `setTranslator`; without a translator it returns the key. Every `onError` gets both: a group's, a list's, a paginated list's, a row field's, and the template resolve of `useForm(entity, template)`.

The cast is needed inside `defineList`, where the parameter type is fixed to `{ notify }`, and it works everywhere. On a group or a leaf written in a plain config object the parameter can be annotated instead: `onError: (error: unknown, { notify, t }: { notify: NotifyFn; t: TranslateFn }) => notify(t("errors.loadProfile"))`.

---

## Store context

> 🔗 **Source:** [modules/lists-demo/StoreContextSection.tsx](https://github.com/ProjectINT/palistor/blob/main/app-demo/src/modules/lists-demo/StoreContextSection.tsx) · **Live result:** [Demo → Lists & entities](https://projectint.github.io/palistor/#lists)

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

`useStoreContext` sets the context in an effect, after mount. For the first render — the server one included — the context has to be in the constructor: pass it there, or put the shared keys on `<PalistorProvider context={{ accountId }}>`. `usePalistor` merges the provider's context into the constructor of every store below (the store's own `context` option wins per key) and pushes later changes into the store; `usePalistorContext()` reads the same values in a component (see [SSR & Next.js](#ssr--nextjs)). `useStoreContext` stays as it is and applies after mount.

---

## SSR & Next.js

> 🔗 **Source:** [app/ssr/](https://github.com/ProjectINT/palistor/tree/main/app-demo/src/app/ssr) — five routes, each a Server Component (`page.cube.tsx`) that reads its data and hands it to a client view with `usePalistor`; the provider and the page frame are in [`shared/`](https://github.com/ProjectINT/palistor/tree/main/app-demo/src/app/ssr/shared). e2e: [e2e/ssr*.spec.ts](https://github.com/ProjectINT/palistor/tree/main/app-demo/e2e) · **Live result:** [Demo → SSR](https://projectint.github.io/palistor/ssr/)
>
> | Route | What it shows |
> |---|---|
> | [`/ssr`](https://projectint.github.io/palistor/ssr/) | A list with server data and a filter (no request after hydration), a list without server data (its skeleton is in the HTML), a `suspense: true` group (its fallback is in the HTML) |
> | [`/ssr/form`](https://projectint.github.io/palistor/ssr/form/) | A group with `resolve` prefilled through `initialData` (`dirty: false`, `reset()` returns to the server's values), re-runs on declared `deps` and on a list's `reload()`, resolver errors translated by `onError` with the store's `t` and sent to the provider's `notifier`, a `usePersist` draft laid over the server's data after mount |
> | [`/ssr/catalog`](https://projectint.github.io/palistor/ssr/catalog/) | The first page of a paginated list as `{ items, total }` (page 2 is one request, page 1 comes back from the cache), a "load more" feed ended by `nextCursor: null`, the `isInitialLoading` skeleton of a paginated list without server data, lists nested in rows |
> | [`/ssr/flow`](https://projectint.github.io/palistor/ssr/flow/) | A flow step with server data (`onEnter` and `onReady` once in the browser, no request), a next step that loads once and stays cached, a flow without data whose active step's loading state is in the HTML |
> | [`/ssr/runtime`](https://projectint.github.io/palistor/ssr/runtime/) | `server: true` and `store.start()`, an eager resolve started by `usePalistor` after the first commit, one store per component instance, a nested `<PalistorProvider context>` driving `contextDeps` |

In the Next.js App Router a Client Component renders twice: on the server into HTML, then in the browser during hydration. A store is not serializable, so it is created twice — once per render — from the same props, and both renders must produce the same markup. On the server effects do not run and a store starts no resolver, so a translator registered with `useTranslator` and the rows a resolver would load are not in the HTML: labels come out as translation keys, a list comes out as its skeleton. Give the constructor what the first render needs — context, translator, data — and the HTML arrives complete, and hydration neither mismatches nor repeats a request.

The server page loads the rows and passes them as props. The client view creates its store with `usePalistor` and hands the rows over as `initialData`:

```tsx
// app/[accountId]/customers/page.tsx — Server Component
import { getCustomers } from "@/data/customers";
import { CustomersView } from "./CustomersView";

export default async function Page({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const customers = await getCustomers(accountId); // on the server, with the user's cookies
  // key: another account is another component instance: a new store with the new rows
  return <CustomersView key={accountId} accountId={accountId} customers={customers} />;
}
```

```tsx
// app/[accountId]/customers/CustomersView.tsx
"use client";
import { defineList, useForm, usePalistor, type PalistorRef, type TranslateFn } from "palistor";

interface Customer { id: string; name: string }

const customersConfig = {
  search: { value: "", placeholder: (t: TranslateFn) => t("customers.search") },
  customers: defineList<Customer>({
    template: { id: { value: "" }, name: { value: "" } },
    resolve: {
      resolver: async (values, store) => api.getCustomers(store.context.accountId, values.search),
      deps: ["search"],           // declared: nothing is auto-tracked until the resolver's first run
    },
  }),
};

export function CustomersView({ accountId, customers }: { accountId: string; customers: Customer[] }) {
  const store = usePalistor(() => ({
    config: customersConfig,
    context: { accountId },
    initialData: { customers },   // the list starts as resolved, without a request
  }));
  const form = useForm(store);

  return (
    <>
      <input
        placeholder={form.search.placeholder}
        value={form.search.value}
        onChange={(e) => (form.search.value = e.target.value)}
      />
      <ul>{form.customers.map((c, i, id) => <CustomerRow key={id} customer={c} />)}</ul>
    </>
  );
}

// A row is read through its own useForm: it re-renders alone when its fields change.
function CustomerRow({ customer }: { customer: PalistorRef<Customer> }) {
  return <li>{useForm(customer).name.value}</li>;
}
```

Values shared by every store — context, translator, notifier — go to `<PalistorProvider>` in a layout. `usePalistor` merges them into the constructor of each store below:

```tsx
// app/providers.tsx — a client wrapper rendered by the layout
"use client";
import { useTranslations } from "next-intl";
import { PalistorProvider } from "palistor";

const notifyError = (error: unknown, code?: string) => addToast({ title: code ?? "Error", color: "danger" });

export function Providers({ account, children }: { account: Account; children: React.ReactNode }) {
  const t = useTranslations();
  return (
    <PalistorProvider context={{ account }} translator={t} notifier={notifyError}>
      {children}
    </PalistorProvider>
  );
}
```

The HTML now has the translated placeholder and the rows. The resolver of `customers` runs neither on the server nor after hydration — only when `search` changes, or on the list's `reload()`.

Every hook module of the package starts with `"use client"`, so a Server Component file can import `Palistor`, `defineList`, `defineFlow` and types from `"palistor"` — a config module shared by the page and the view, for example. The hooks arrive there as client references and are not executed.

### One store per component instance

Create a store that holds request data inside the component: `usePalistor` builds it once per component instance and returns the same store on every render. A module-level store lives as long as the server process and is shared by every request, so request data must never get into it. That is why `initialData` exists only in the constructor — there is no method that adds it later. `usePalistor` reads `config` and `initialData` once: a component that must start over with new data needs a new `key`.

A module-level store without request data keeps working under SSR as it is: server mode applies to it too.

### Server mode

A store created where `window` is undefined is in server mode: it starts nothing by itself. No eager resolver, no lazy resolver on read, no page fetch, no flow step entry (`onEnter` / `onReady` are not called). Whatever would have started reads `loading: true`, and the store the browser creates runs each resolver once. `useStoreContext`, `useTranslator`, `useNotifier` and `usePersist` work in effects, which the server does not run, so on the server they do nothing.

`usePalistor` keeps the same rule for a render in the browser. It builds the store held, so nothing starts during a render, and an effect calls `store.start()` once the component has committed. The first client render therefore reads what the server's render read — `loading: true`, a list's `resolveStatus: "idle"` — and the two are equal by construction. A render React throws away (a transition interrupted because another store changed under it, a component that suspends before its first commit) leaves a store that has requested nothing: only the committed instance's store starts. With `server: true` the hook is in manual mode: it never starts the store, and `store.start()` is yours to call. A store made with `new Palistor()` is not held: in the browser its constructor starts it.

One consequence outside Next.js: a Node script or a test without a DOM is in server mode too. Start the store explicitly, or turn the mode off:

```typescript
const store = new Palistor({ config });                 // Node: no `window` → server mode
store.start();                                          // flow step entry, eager resolvers, every resolver already read

const client = new Palistor({ config, server: false }); // or: behave as in the browser
```

`store.start()` is idempotent, and after it the store behaves as in the browser. Tests under jsdom are not affected: `window` exists there.

### `loading` on the first render

```tsx
const customers = useForm(store).customers;

if (customers.loading) return <Skeleton />;
return <ul>{customers.map((c, i, id) => <CustomerRow key={id} customer={c} />)}</ul>;
```

Without `initialData` this renders the skeleton on the server and in the client's first render, so the two match. The rule behind it: a resolver that is about to run already reads `loading: true` — an eager one (`lazy: false`) and the active flow step's from the moment the store is created, a lazy one from its first read. Reading `loading` of a group, a list or a flow is such a read: it wakes the lazy resolver exactly like reading `items` or a field does, and so does `isInitialLoading` of a paginated list. The rule is the same in the browser, where `loading` is `true` between the first read and the start of the run. With `usePalistor` the run starts after the first commit, so the hydrating render reads `loading: true` and `resolveStatus: "idle"`, exactly as the server's render did.

A resolver that waits for its `contextDeps` reads `loading: false`: it is not about to run. A flow step's `loading` does not wake the step's resolver — the flow starts it on entry. `resolveStatus` stays `"idle"` until the run really starts.

### `suspense: true` on the server

Put a `<Suspense>` boundary above the component that reads a `suspense: true` node. With no data the server has no run to wait for, so it sends the boundary's fallback and leaves the content to the browser:

```tsx
export function CarView() {
  const store = usePalistor({ config: carConfig }); // car.resolve.options.suspense: true
  return (
    <Suspense fallback={<Spinner />}>
      <CarCard store={store} /> {/* reads form.car.loading and its fields — below the boundary */}
    </Suspense>
  );
}
```

On the server the read throws an error that Next.js treats like `next/dynamic` with `ssr: false`: it sends the fallback, logs nothing and renders the content in the browser. Outside Next.js React sends the fallback as well, but reports the error to the server's `onError` and, during hydration, to `onRecoverableError` — once per boundary.

- **The boundary is required** above whatever reads a `suspense: true` node, as always. Without one the error is fatal for the server render.
- **In the browser the first render shows the defaults.** A `usePalistor` store is held until its component commits, but it is not in server mode: it has no run to throw and does not throw the server's error either, so a `suspense: true` node without data renders its default values with `loading: true`. (A store built with `server: true` is in server mode in the browser too, until `store.start()`.) Once the store starts, a component that reads the node's own `loading` along with its fields re-renders and suspends: the boundary's fallback, then the data. A `suspense: true` list is held the same way: an empty first render without an error, then the fallback, then the rows.
- **The component that calls `usePalistor` may read the node itself.** It suspends after its commit, so React keeps its state: one store, one request. The boundary then goes above that component.
- **A component that reads only the node's children is not re-rendered by the start**: it keeps the defaults until the data lands and never shows the fallback on a client mount. Below the boundary read the node's `loading` as well, or branch on it (`if (car.loading) return <Skeleton />`), or give the node `initialData`. A list re-renders its readers when the run starts, so a reader of a `suspense: true` list always reaches the fallback.
- **A component that suspends before its first commit for another reason keeps nothing**, the store included: the options function runs again and another store is built — but none of them requests anything.
- **`initialData` for that node removes the wait**: the content is in the server HTML, and nothing suspends.
- **Reading only `loading` never suspends**: the component renders its own skeleton, on the server too.

### `initialData`

Pass what the server has already loaded as `initialData`, in the shape of `store.getValues()`. A key the data lacks is left alone, and that node resolves as usual.

```typescript
const store = new Palistor({
  config,
  initialData: {
    // a group: its values
    profile: { name: "Ann", email: "ann@example.com" },
    // a list: an array of rows; nested lists sit inside their rows
    customers: [{ id: "c1", name: "Acme", orders: [{ id: "o1", amount: 90 }] }],
    // a paginated list: its first page as the resolver returns it (a bare array works too)
    invoices: { items: firstPage, total: 240 },
  },
});
```

A node with `resolve` that got data is in the state its resolver would have left by returning the same data: the values, the dirty baseline (`dirty: false`; `reset()` returns to this data and requests nothing, for nested lists too), the list membership, `resolveStatus: "resolved"`, `loading: false`. Its resolver is called neither on the server nor after hydration. The one exception is nested lists: `initialData` (like a persisted draft) fills the lists nested in its rows, while the rows a list resolver returns do not — a nested array inside a resolver's row is not a nested list's membership. A nested list is filled by its own resolver, by `setItems` / `add`, or by `initialData`. A flow step that got data fires `onEnter` and then `onReady` at once on its first entry, without a request. Both renders need the same data; in Next.js they get it with the same props.

`initialData` is not `initialValues`: those only override the config defaults, and a node with `resolve` still resolves after them. The data is applied over `initialValues`. A group's own `resolve` counts as answered when the data carries a value for at least one leaf below it, outside lists: `{ customers: [...] }`, a list nested in a subgroup or an empty `{ car: {} }` do not answer the `resolve` of a group or of the root.

Limits:

- **Declare `deps`.** The resolver has not run in the browser, so the reads auto-tracking would have found are unknown until its first real run. Until then the node re-runs only on its declared `resolve.deps`, on a change of a `contextDeps` key, on a change of the list's filter and on the list's `reload()`. A group has no `reload()`: it is re-run only by its declared `deps` and `contextDeps`. If a list must reload when a field changes, name that field in `deps`. A paginated list is keyed on `deps` and the filter (it ignores `contextDeps`); its next page is requested as usual.
- **The data must be what the store would request right now**: for the initial filter values, the first page (`pagination.initialPage`) and the same context. The context has to be in the constructor or the provider: a `contextDeps` key that arrives later through `useStoreContext` counts as a change and re-runs the resolver right after hydration. A paginated list files the rows under its current query key.
- **The data is embedded in the HTML.** Props of a Client Component are serialized into the page — pass only what the user may see.
- **Every row needs an `id`.** A row without one gets a temporary id that differs between the server and the browser (dev warning).
- **Keys that are not in the config are ignored** (dev warning).

### With `usePersist`

`usePersist` hydrates in an effect, after mount, so the saved draft is laid over the server data: the first render matches the server HTML, then the draft appears and the form is dirty against the server data. This order is intended.

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
| `Resolve<T>` / `NotifyFn` / `ResolveErrorContext` | Resolver contracts. `ResolveErrorContext` is declared as `{ notify }`; `onError` also gets `t`, added to the type in 0.1. Until then annotate the parameter as `{ notify, t }: { notify: NotifyFn; t: TranslateFn }`, or inside `defineList` cast: `ctx as ResolveErrorContext & { t: TranslateFn }` |
| `InitialData<TConfig>` / `PalistorOptions` / `PalistorProviderProps` | SSR contracts: the `initialData` shape for a config, constructor options, provider props |

---

## License

[MIT](./LICENSE) © Yuri Palienko
