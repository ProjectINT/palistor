# Palistor

> A declarative MVVM-like framework for React — AI-friendly, forms, lists and step wizards.

**English** | [Русский](./README.ru.md)

[![npm version](https://img.shields.io/npm/v/palistor.svg)](https://www.npmjs.com/package/palistor)
[![npm cube](https://img.shields.io/npm/v/palistor/cube.svg?label=palistor%40cube)](https://www.npmjs.com/package/palistor?activeTab=versions)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![react](https://img.shields.io/badge/react-%5E19-61dafb.svg)](https://react.dev)

> **This README describes Palistor 0.1**: the new Cube core, server rendering (`usePalistor`, `initialData`) and agent skills. While 0.1 is a prerelease it is published under the `cube` dist-tag: `npm install palistor@cube`. A plain `npm install palistor` still installs the 0.0.x line, which has none of these. Coming from 0.0.x: see [Migrating to 0.1](#migrating-to-01).

**Palistor is a declarative MVVM-like framework for stateful, data-driven React interfaces.**

Palistor splits the frontend into three layers:

1. The view layer. This is the JSX layer, stripped of everything except the actual rendering. By rendering here we mean markup, layout and styles.

A markup example (View in MVVM terms):
```tsx
function Form() {
  const form = useForm(store);

  return (
    <>
      <Input {...form.email} />
      {form.phone.isVisible && <Input {...form.phone} />}
    </>
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
      isVisible: (v: { email: string }) => v.email !== "",
      resolve: {
        resolver: async (v: { id: string }) => await getPhone(v.id), // getPhone is already the data layer; the result becomes the field's value
      },
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
- [Migrating to 0.1](#migrating-to-01)
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
 - State lives in the store, not in React: the store computes derived values, and a component re-renders only when a field it actually read has changed → targeted re-renders instead of cascading ones.
 - Better code organization, and more natural reuse of things like validators, formatters, and other helpers.

All of this lets us grow the complexity of every layer and add new functionality without sacrificing stability or predictability. And, most importantly, move toward generating frontends for enterprise systems.

### Use cases for Palistor

Admin panels, SaaS platforms, consoles, personal dashboards — anything built mostly from forms, step wizards, dynamic widgets and tables:
 - Onboarding / KYC / verification / questionnaires — branching multi-step wizards, conditional fields, step-by-step validation (`defineFlow`).
 - Checkouts and payment forms — conditional payment methods, cross-field rules, async loading.
 - Configurators / calculators / CPQ — computed fields and their dependencies (price×quantity→tax→total) without a single useEffect.
 - Reference-data-driven forms — dependent selects (country→city), options via `resolve`.
 - CRUD entity editors and tables with inline editing — a normalized registry, list API, per-entity templates.
 - Schema-driven / backend-driven forms — since the config is data, it can be generated or served from the backend. Plus the multi-region angle: context for regions/laws.
 - Dashboards with form-like filters — a filter panel as a reactive data source.

### What Palistor is not for

Landing pages with no complex logic, where the main goal is to ship a simple page fast.
 - Content sites: blogs, docs, marketing, SSG — SEO-first, static, almost no behavior.
 - Graphics / canvas / realtime rendering — games, editors (rich text, diagrams, maps), video players, heavy visualizations. Here the complexity lives in rendering, and the model doesn't split into layers.
 - Trivial UI — a single search box, one button, a form with a couple of fields: the three-layer split is overhead that doesn't pay off.
 - Embeddable widgets where bundle size is critical — the library weighs about 30 KB minified and gzipped (React excluded), a downside for an embeddable script on someone else's page.

---

## Demo

A live playground with the examples from this README: **[projectint.github.io/palistor](https://projectint.github.io/palistor/)**

Each tab is a separate framework feature, and every one has a direct deep link:

- [Quick start](https://projectint.github.io/palistor/#form) — conditional fields, submit pipeline, persist
- [Flows](https://projectint.github.io/palistor/#flow) — a step wizard with branching
- [Lists & entities](https://projectint.github.io/palistor/#lists) — normalized registry, list API, pagination, store context
- [Async resolvers](https://projectint.github.io/palistor/#async) — data loading, retry, notifications
- [Field mapping](https://projectint.github.io/palistor/#mapping) — rename props to your UI kit

The playground sources live in [`app-demo/`](./app-demo). Each section below links to the specific example code and its live tab.

> The live playground is deployed from `main`. The server-rendering routes (`/ssr`, `/ssr/form`, `/ssr/catalog`, `/ssr/flow`, `/ssr/runtime` — see [SSR & Next.js](#ssr--nextjs)) and the list routes (`/lists`, `/lists/orders`, `/lists/customers`, `/lists/feeds` — see [Lists & entities](#lists--entities)) reach it together with 0.1. Until then run the playground locally: `npm ci` in the repository root and in `app-demo/`, then `npm run dev` in `app-demo/` and open [localhost:3001/palistor/](http://localhost:3001/palistor/).

---

## Features

The feature set aims to cover every typical need of a modern frontend — forms, lists, step wizards.

Palistor's philosophy is to provide a complete toolkit for generating any frontend, using all the best and most traditional practices.

| | |
|---|---|
| **Granular re-renders** | A component re-renders only when the state of a node it read has changed — a write elsewhere, or a recompute that gives the same result, does not re-render it |
| **Computed field state** | `isVisible`, `isRequired`, `label`, a computed `value`, validation errors — lazy getters whose dependencies are tracked automatically; nothing to declare |
| **Native syntax** | `form.email.value = x` instead of dispatching actions; `{...form.email}` spreads the field props into a component. Nodes are plain objects with getters, not Proxies |
| **Submit pipeline** | `beforeSubmit → validate → onSubmit → afterSubmit`; errors appear after the first submit |
| **Dirty tracking** | Per-field, per-group and per-list change flags; the baseline moves after a resolve and `reset(values)` |
| **Async resolvers** | Data loading on groups, fields and lists with auto-tracked dependencies (reads after `await` included), retry, optimistic values and React Suspense |
| **Lists & entities** | Normalized entity registry, list API with `add / remove / setItems`, per-entity templates, nested lists |
| **Filtering** | A `filter` block on a list: server fields re-fetch (with debounce), client fields filter the loaded rows; an "Apply" mode keeps the fields a draft until `filter.apply()` |
| **Sorting** | A `sort` block on a list: a header click sorts the loaded rows in the browser, or sends the sort to the resolver of a paginated list — one request per change |
| **Pagination** | Page-level cache — switching to a fresh cached page never calls the resolver; `paged` / `infinite` / `cursor` modes, persisted windows, nested lists |
| **Flows** | Step wizards via `defineFlow` / `defineStep`: navigation, branching, per-step validation |
| **Field mapping** | Rename field-state props to your UI kit's convention (`isRequired` → `required`, …) |
| **Persist** | Autosave to `localStorage`, `sessionStorage` or any custom driver — list membership and flow navigation included |
| **i18n** | Register a translator once — every `label: (t) => t("key")` is translated everywhere |
| **SSR & Next.js** | `usePalistor`, `<PalistorProvider>`, `initialData`: data and translations in the first HTML, no store requests on the server, no refetch after hydration |
| **Agent skills** | Five skills for AI coding agents ship inside the package and follow its version |
| **Testability** | The core is framework-agnostic and fully testable without React |

---

## Installation

The package is published to the **public npm registry** as `palistor`. Until 0.1 becomes `latest`, install it with the `cube` dist-tag:

```bash
npm install palistor@cube
# or
yarn add palistor@cube
# or
pnpm add palistor@cube
```

**Peer dependency:** `react ^19`

The package is ES modules for bundlers (Next.js, Vite, webpack) and test runners such as Vitest; plain `node` cannot import it.

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
  usePalistor,
  PalistorProvider,
  usePalistorContext,
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

The subpath entries of 0.0.x keep working: `palistor/react/useForm`, `palistor/react/usePersist`, `palistor/react/useTranslator`, `palistor/react/useNotifier`, `palistor/store/store`, `palistor/store/persist`. `palistor/cube` is the same as the root. New code imports from the root.

---

## Agent Skills

Palistor ships its own instructions for AI coding agents: five [Agent Skills](https://agentskills.io) inside the npm package (`node_modules/palistor/skills/`), versioned together with the code they describe. An agent that loads them writes configs by the rules of the version you have installed instead of guessing. The skills ship from 0.1 on (`palistor@cube`); the 0.0.x packages have none.

**Recommended — [TanStack Intent](https://tanstack.com/intent/latest):**

```bash
npm i palistor@cube
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
| `palistor-ssr` | Server rendering in Next.js (App Router): `usePalistor`, `PalistorProvider`, `initialData`; data and translations in the first HTML, no store requests on the server, no refetch after hydration; one store for the whole app |

The skills are updated together with the package: `npm update palistor` also brings the instructions for the new version. The repository installs above read the default branch (`main`), not your installed version; `main` receives the skills together with the 0.1 release, so until then use Intent, which reads them from the installed package.

---

## Quick start

> 🔗 **Source:** [config/payment.ts](./app-demo/src/config/payment.ts), [modules/payment-form/](./app-demo/src/modules/payment-form) · **Live result:** [Demo → Payment Form](https://projectint.github.io/palistor/#form)

### 1. Describe the form

The config is declarative: field values, validation, visibility and lifecycle callbacks live in one tree. Create the store at module level (a store that holds request data is created inside a component instead — see [SSR & Next.js](#ssr--nextjs)).

```typescript
import { Palistor } from "palistor";

interface PaymentValues {
  paymentType: string;
  cardNumber: string;
  passport: { number: string; issueDate: string };
  amount: number;
}

export const paymentStore = new Palistor({
  config: {
    paymentType: { value: "card", label: "Payment method" },
    cardNumber: {
      value: "",
      label: "Card number",
      placeholder: "0000 0000 0000 0000",
      isVisible: (v: PaymentValues) => v.paymentType === "card",
      isRequired: (v: PaymentValues) => v.paymentType === "card",
      validate: (value: string, v: PaymentValues) =>
        v.paymentType === "card" && value.length < 16 ? "Enter 16 digits" : undefined,
    },
    passport: {
      isVisible: (v: PaymentValues) => v.paymentType === "bank",
      number:    { value: "", label: "Passport number" },
      issueDate: { value: "", label: "Issue date" },
    },
    amount: {
      value: 0,
      label: "Amount",
      validate: (value: number) => (value > 0 ? undefined : "Enter an amount"),
    },
    onSubmit: async (values: PaymentValues) => api.pay(values),
  },
});
```

Every field of the form is validated on submit, hidden ones included (fields of list rows and of hidden flow steps aside). A field that is required in one branch only says so in its own `isRequired` / `validate`, as `cardNumber` does. A function of a field inside a group receives that group's values (see [Which values a function gets](#which-values-a-function-gets)), so `passport.number` could not read `paymentType`: the branch condition sits on the `passport` group, which reads the root.

### 2. Connect a component

```tsx
import { useForm } from "palistor";
import { paymentStore } from "./paymentStore";

function PaymentForm() {
  const form = useForm(paymentStore);

  return (
    <form onSubmit={(e) => { e.preventDefault(); void paymentStore.submit(); }}>
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
import { useForm, type PalistorProxy } from "palistor";

function PassportSection({ passport }: { passport: PalistorProxy<PaymentValues["passport"]> }) {
  // Own tracking scope — re-renders only when passport fields change
  const p = useForm(passport);

  return (
    <>
      <Input {...p.number} />
      <Input {...p.issueDate} />
    </>
  );
}
```

> **Without `useForm` in the child** the component reads through the parent's tracking scope: its reads count as the parent's, and both re-render together. That's fine for simple leaf components.

The node in the prop can just as well be a single field, and the chain goes as deep as the config does: see [One component per node](#one-component-per-node).

---

## Concepts

### Node kinds

The config is a tree, and the kind of a node follows from its shape:

```
Has  "value"                    →  leaf   (a field)
No   "value"                    →  group  (a section, a form)
defineList(…) or [template]     →  list   (rows of an entity registry)
defineFlow(…)                   →  flow   (a group whose children are steps)
```

```typescript
const config = {
  // Leaf — owns a value
  email: { value: "", isRequired: true },

  // Group — a container with computed properties
  address: {
    isVisible: (v: { showAddress: boolean }) => v.showAddress,
    city:    { value: "" },
    country: { value: "US" },
  },
};
```

### How the core works

Since 0.1 Palistor runs on the **Cube** core: one internal primitive and automatic dependency tracking, instead of dependency maps and a recompute pass.

- **One primitive.** Every node — leaf, group, list row, flow step — is one internal class, a *cube*; lists, flows, steps and filters are thin subclasses of it. A row's subtree is built on first access, so a list of 1 000 rows holds 1 000 light objects, not 1 000 copies of its template.
- **Derived state is a lazy memo.** `isVisible`, `isRequired`, `label`, a computed `value`, `errorMessage`… are getters. Each one remembers the versions of what it read — other nodes, the translator — and recomputes only when one of them has moved, and only when it is read again. Nothing is declared, sorted or recomputed up front: the dependencies are whatever the function read the last time it ran. Resolvers are tracked the same way, reads after an `await` and `store.context` keys included.
- **Nodes are plain objects.** `store.proxy.email` is an ordinary object, not a Proxy. Its own enumerable properties are exactly what a spread should give — for a field, the field-state props and `onValueChange` — so `{...form.email}` goes straight into a component; a group's children and the remaining members are non-enumerable getters on a prototype shared by every node of one config. The core's internals never take a child's name; a short list of names is reserved for the node's own API (see [`ConfigNode`](#confignode--field-schema)).
- **A Proxy only at the edges.** `useForm` wraps the nodes in a thin tracking Proxy that records which nodes the component read *state* from; a resolver run sees `store.context` through one that records the keys it reads. The core itself has none.
- **State versions.** Each node has a version of its observable state — value, computed flags and strings, `dirty`, errors, `loading` — that moves only when one of them actually changes, not on every change of a dependency. A computed `total` that comes out the same after a write does not move.
- **One action, one notification.** A write with its setter patch, a `setValues`, a `reset`, a resolver result is one batch: subscribers are notified once, after it, and then the resolvers whose dependencies have moved check again.

### How tracking works

```
Render: the component reads form.email.value and form.phone.isVisible
        → read set = { email, phone }

form.city.value  = "Paris"   → city's state moved; city is not in the read set → no re-render  ✓
form.email.value = "a@b.c"   → email's state moved                            → re-render     ✓
form.qty.value   = 3         → total = price × qty is recomputed when read;
                               a reader of total re-renders only if the total changed           ✓
```

A component that only navigates (`form.passport`) and passes the subtree down without reading its state does **not** re-render when fields inside `passport` change. Reading any state of a node subscribes to all of it: a parent that reads `form.passport.isVisible` also re-renders when `passport.dirty` or `passport.submitting` flips. The read set follows the renders — it holds the reads of the last two renders, not everything the component has ever read. `useForm(subtree)` in a child opens a read set of its own.

### One component per node

The component tree can mirror the config tree. A component gets its node as a prop, calls `useForm` on it and hands its children their nodes: a group to a section, a single field to an input. The rule is the same on every level, so the chain goes as deep as the config does.

```tsx
import { Palistor, useForm, type FieldProxyNode, type PalistorProxy } from "palistor";

interface Geo      { lat: number; lng: number }
interface Address  { city: string; street: string; geo: Geo }
interface Customer { name: string; address: Address }

const orderStore = new Palistor({
  config: {
    number: { value: "" },
    customer: {
      name: { value: "" },
      address: {
        city:   { value: "" },
        street: { value: "" },
        geo: { lat: { value: 0 }, lng: { value: 0 } },
      },
    },
  },
});

// Level 0, the root: the only component that sees the store
function OrderForm() {
  const form = useForm(orderStore);
  return (
    <>
      <TextField field={form.number} />
      <CustomerSection customer={form.customer} />
    </>
  );
}

// Level 1: the `customer` node
function CustomerSection({ customer }: { customer: PalistorProxy<Customer> }) {
  const c = useForm(customer);
  return (
    <>
      <TextField field={c.name} />
      <AddressSection address={c.address} />
    </>
  );
}

// Level 2: the `customer.address` node
function AddressSection({ address }: { address: PalistorProxy<Address> }) {
  const a = useForm(address);
  return (
    <>
      <TextField field={a.city} />
      <TextField field={a.street} />
      <GeoSection geo={a.geo} />
    </>
  );
}

// Level 3: the `customer.address.geo` node
function GeoSection({ geo }: { geo: PalistorProxy<Geo> }) {
  const g = useForm(geo);
  return (
    <>
      <NumberField field={g.lat} />
      <NumberField field={g.lng} />
    </>
  );
}

// A leaf: one component for any string field, on any level
function TextField({ field }: { field: FieldProxyNode<string> }) {
  const f = useForm(field);
  return <input value={f.value} onChange={(e) => f.onValueChange(e.target.value)} />;
}

function NumberField({ field }: { field: FieldProxyNode<number> }) {
  const f = useForm(field);
  return <input value={f.value} onChange={(e) => f.onValueChange(Number(e.target.value))} />;
}
```

- **The parent picks the node.** `TextField` stands on `number`, `name`, `city` and `street`: four fields on three levels, one component.
- **A component does not know the store.** It is typed by the shape of its node (`PalistorProxy<Address>`, `FieldProxyNode<string>`) and imports no store and no config. The node in the prop carries its store, so the component is on the store its parent started from and on exactly the node it was given. The root can be a `usePalistor` store just as well: nothing below it changes.
- **Re-renders stay local.** Editing `geo.lat` re-renders the `lat` field alone: `OrderForm`, the three sections and every other field do not. A component that only hands nodes down has read no state.
- **A section that reads a state of its own node follows all of that node's state.** With `if (!a.isVisible) return null` in `AddressSection`, the first edit below it turns `address.dirty` on and re-renders the section once, its children with it; the next edits re-render the field alone.

Only a node that came from another `useForm` can be handed down: `useForm(orderStore.proxy.customer)` is an error (see [`useForm(source)`](#useformsource)).

### Write data flow

```
form.email.value = " User@Example.com "
  │
  ├─ 1. formatter(raw, values)          → normalized value; an unchanged value skips the write (console warning)
  ├─ 2. store                           → the leaf's version moves
  ├─ 3. setter(value, values, prev)?    → a patch for sibling fields, applied in the same batch
  ├─ 4. notify                          → one cycle: subscribers of the nodes whose state changed;
  │                                       computed getters recompute lazily, when they are read
  ├─ 5. resolvers                       → those that read a changed value run again
  └─ 6. onChange                        → on the leaf, then on every ancestor group: a microtask later,
                                          fire-and-forget; a returned patch is applied
```

`setValues` and `reset` take a shorter path: no setter and no `onChange` (`setValues` still runs formatters).

### Which values a function gets

| Callback | Its `values` argument |
|---|---|
| computed `value`, `isVisible` / `isRequired` / `isDisabled` / `isReadOnly`, `validate`, `setter` | the values of the node's parent group (for a top-level node: the whole form) |
| `label` / `placeholder` / `description`, `formatter`, `onChange` (`allValues`) | the whole form's values (inside a list: the row's) |
| `resolver` | the whole form's values (for a resolve inside a list template: the row's) |

So a field nested in a group cannot read a field outside it: put the condition on the group, or keep the field and its condition in one group. The flag functions also receive the translator as their second argument: `isVisible: (values, t) => …`.

### Validation timing (`revalidate`)

Validation errors are hidden until the first `submit()` of the field or of any group above it — successful or not. From then on the `revalidate` flag is `true` and `isInvalid` / `errorMessage` update live on every keystroke, until `reset()`. Fields of list rows have no such gate: their `validate` shows live from the start, and it does not block a submit of the form (a form submit does not check list rows; `item.submit()` does).

---

## API reference

### `new Palistor(options)`

```typescript
import { Palistor } from "palistor";

const store = new Palistor({
  config,          // ConfigNode tree — required
  initialValues,   // deep-partial values that override config defaults (and become the dirty baseline)
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
| `store.proxy` | node | The root node: plain getters mirroring the config (`store.proxy.email.value`, assignable). Components do not track reads through it — use it outside React, and `useForm(store)` in components. Passing it or any of its nodes to `useForm` throws |
| `store.getValues()` | values | Deep **clone** of all current values as a nested object (lists as arrays of rows) |
| `store.submit()` | `Promise<SubmitResult>` | Submit the root group: validates every field, hidden ones included (list rows and hidden flow steps aside), then calls the root's `onSubmit`. Rejects when a callback throws |
| `store.reset(values?)` | `void` | `reset()` returns the form's fields to their baseline — `initialValues`, resolved or `initialData` data, the last `reset(values)` — hides the errors and sends flows back to their first step; a root list keeps its membership and its rows keep their field values (see Lists & entities). `reset(values)` writes those keys and makes the whole current state the new baseline |
| `store.setValues(patch)` | `void` | Bulk patch in one notification: formatters run, setters and `onChange` don't; lists and unknown keys are ignored |
| `store.set(data)` | `void` | Upsert an entity or an array of entities in the registry (recursive merge; a row without an id gets a `_tmp_…` one) |
| `store.delete(id)` | `void` | Remove an entity everywhere (cascades to child entities it owns) |
| `store.rekey(oldId, newId)` | `void` | Rename an entity in the registry and in every list |
| `store.invalidate(id, template?)` | `void` | Forget that the template resolve of `useForm(entity, template)` ran for this entity (`template` is the template's config object; without it, every template); the next mount runs it again |
| `store.subscribe(node, fn)` | unsubscribe | Called when the node's observable state changes — for a group its own flags, `dirty`, `submitting`, `revalidate`, not every nested value. Pass the node: `store.proxy.email` |
| `store.subscribeGlobal(fn)` | unsubscribe | Called once per notification cycle (one per action) |
| `store.getVersion()` | `number` | Number of notification cycles so far |
| `store.getNodeVersion(node)` | `number` | Changes when the node's observable state has changed; compare for inequality only |
| `store.setTranslator(fn \| null)` | `void` | Register an i18n function |
| `store.setNotifier(fn \| null)` | `void` | Register a notification function |
| `store.setContext(ctx)` | `void` | Shallow-merge non-reactive context: re-renders nothing, re-runs the resolvers that read a changed key (see Store context) |
| `store.context` | object | Current non-reactive context |
| `store.persist` | `PersistManager` | Persistence: `enable / disable / flush / clear / hydrate / isEnabled` (see Persist) |
| `store.start()` | `void` | Run what the store starts by itself: flow step entry, eager resolvers, every resolver already read. The constructor of `new Palistor()` calls it outside server mode; for a `usePalistor` store the hook calls it after the first commit. Idempotent (see SSR & Next.js) |

---

### `useForm(source)`

```typescript
import { useForm } from "palistor";

const form    = useForm(store);            // tracking scope over the whole store
const section = useForm(form.address);     // a group (from a prop): its own tracking scope
const city    = useForm(section.city);     // a single field (from a prop): a scope over that one node
const entity  = useForm(item, (s) => s.editForm); // bind an entity to a template
```

Returns the store's nodes wrapped in a tracking scope. The component re-renders only when the state of a node it read changes. Writes go straight to the node.

| Overload | When to use |
|---|---|
| `useForm(store)` | Root of a form; pass nodes down as props |
| `useForm(groupProp)` | A section with independent re-renders; the prop is typed `PalistorProxy<T>` |
| `useForm(fieldProp)` | A one-field component; the prop is typed `FieldProxyNode<T>`, and the same node comes back |
| `useForm(rowProp)` | A row of a list (`PalistorRef<T>`), see [Lists & entities](#lists--entities) |
| `useForm(filterProp)` / `useForm(sortProp)` | A filter panel or a sort header: the prop is `list.filter` (`FilterProxyNode`) or `list.sort` (`SortProxyNode<K>`), and the same node comes back. See [Filtering](#filtering), [Sorting](#sorting) |
| `useForm(entityProxy, templateSelector)` | Render/edit a list entity through a template (binds on mount, unbinds on unmount) |

A node in a prop is bound to its store and to its place in the tree: the child needs no store import, and the parent decides which node the child shows. The chain can be any depth, see [One component per node](#one-component-per-node).

> ⚠️ Passing a raw `store.proxy` node, a group or a field (e.g. `useForm(store.proxy.address)`), is a **compile-time and runtime error**. Always go through `useForm(store)` first and drill into what it returns.

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

After mount the hook follows only these three and pushes a change with `store.setContext` / `setTranslator` / `setNotifier`: from the provider always, from the options only when they are passed as an object (a function has been read once). The context is merged per key: a key that disappears keeps its last value in the store — pass it as `undefined` to clear it. `config`, `initialValues`, `initialData`, `fieldMapping` and `server` are read once; a component that must start over with new data needs a new `key`. Unmount resets nothing: the store goes with the component. A store for the whole app is this hook called once, in a provider the layout renders — see [One store for the whole app](#one-store-for-the-whole-app).

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

### Leaf node — properties

```typescript
// Reads through useForm register the node in the component's read set
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
form.email.loading        // → boolean for a field with `resolve`, undefined otherwise (not in the FieldProxyNode type yet)

// Writes run formatter → store → setter → one notification → onChange (see Write data flow)
form.email.value = "new@example.com";
form.email.onValueChange("new@example.com"); // equivalent, handy as a callback prop

// A leaf can also be submitted on its own
form.email.submitting        // → boolean
await form.email.submit();   // → SubmitResult
```

A spread `{...form.email}` gives `value`, `label`, `placeholder`, `description`, the four flags, `isInvalid`, `errorMessage`, `onValueChange` and the keys of `componentProps`. `dirty`, `loading`, `submitting` and `submit` are readable but not spread.

A leaf's own `submit()` validates only this leaf, passes its value (after its `beforeSubmit`) to its `onSubmit(value, store, parentNode)`, and the `reset` handed to its `afterSubmit` resets the parent group. Error paths are full paths (`"user.email"`).

### Group node — properties

```typescript
form.passport.isVisible     // → boolean (default true)
form.passport.isRequired    // → false by default (typed boolean | undefined)
form.passport.isReadOnly    // → false by default (typed boolean | undefined)
form.passport.isDisabled    // → false by default (typed boolean | undefined)
form.passport.isInvalid     // → boolean | undefined — the group's own validate only
form.passport.errorMessage  // → string | undefined — the same
form.passport.submitting    // → boolean
form.passport.loading       // → boolean (async resolver in progress or about to start)
form.passport.dirty         // → boolean (at least one field changed)
form.passport.revalidate    // → boolean (true after the first submit, until reset)
form.passport.values        // → the group's values (a stable object of getters)

await form.passport.submit();          // → SubmitResult
form.passport.reset();                 // the subtree back to its baseline
form.passport.reset({ number: "" });   // write these keys; the current state becomes the baseline
form.passport.setValues({ number: "AB1234" }); // bulk patch: formatters run, setters and onChange don't
```

A group's flags are its own: its fields do not inherit them. A field inside a hidden group still reads `isVisible: true` — render the group conditionally, as the Quick start does. `isInvalid` / `errorMessage` of a group come only from the group's own `validate`, not from its fields (`isRequired` on a group sets the flag but never an error), and they are for display only: a group's `validate` does not block a submit. To show a section error from its fields, read the fields.

`values` is one stable object whose properties read the current values: a later read sees later writes. In config functions and resolvers reading `values.number` depends on `number` only. In a component, `values` counts as the group's own state and does not re-render on field edits — render `form.passport.number.value` instead. Spread, `JSON.stringify` and `structuredClone` copy the current state; for a detached deep clone use `store.getValues()`.

A group's `submit()` validates its fields (list rows aside) and passes a plain copy of its values — hidden fields included, after the `beforeSubmit` transforms — to its own `onSubmit`. `store.submit()` calls only the root's `onSubmit`; a nested group's `onSubmit` runs on `form.group.submit()`. Error paths are relative to the submitted group.

---

### `ConfigNode` — field schema

```typescript
// Leaf node (has "value")
{
  value?: TValue | ((values: TValues) => TValue),   // static or computed (computed is read-only)
  validate?:  (value, values, t) => string | undefined | false,
  formatter?: (raw, values) => TValue,               // normalize on write
  setter?:    (value, values, previousValue) => DeepPartialValues<TValues>, // patch sibling fields
  beforeSubmit?: (value, values) => TValue,          // transform the submitted value, synchronously (no mutation);
                                                     // values: the submitted group's payload, or the parent's values in leaf.submit()
  resolve?:   Resolve<TValue>,                       // the result becomes the value; per entity inside a list template
  onChange?, onSubmit?, afterSubmit?,                // as on a group, for this field alone
  componentProps?: Record<string, unknown>,          // extra props spread together with the field
  dependencies?: string[],                           // accepted and ignored: dependencies are tracked automatically

  label?:       string | ((t, values) => string),
  placeholder?: string | ((t, values) => string),
  description?: string | ((t, values) => string),
  isVisible?:   boolean | ((values, t) => boolean),  // default: true
  isRequired?:  boolean | ((values, t) => boolean),  // default: false
  isDisabled?:  boolean | ((values, t) => boolean),  // default: false
  isReadOnly?:  boolean | ((values, t) => boolean),  // default: false
}

// Group node (no "value")
{
  beforeSubmit?: (values, parentValues) => values | Promise<values>,
  onSubmit?:     (values, store, parentNode) => Promise<unknown> | unknown,
  afterSubmit?:  (result, { reset }) => void | Promise<void>,
  reset?:        (baseline) => values,               // transform applied by reset() without arguments
  onChange?:     ({ fieldKey, newValue, previousValue, allValues }) => patch | void,
  validate?:     (values, parentValues, t) => string | undefined, // the group's own isInvalid / errorMessage (display only)
  resolve?:      Resolve,                            // async resolver (see below)

  isVisible?, isRequired?, isDisabled?, isReadOnly?, // as on a leaf; not inherited by the fields

  [childKey]: LeafNode | GroupNode | ListNode,       // children
}

// List node — array of length 1 or 2 (or use defineList)
[templateGroupNode]
[templateGroupNode, { resolve?, filter? }]
```

Which `values` each callback receives: see [Which values a function gets](#which-values-a-function-gets).

**`onChange`** fires only for writes (`node.value = …`, `onValueChange`) — not for `setValues`, `reset`, resolver results or setter patches. It runs a microtask after the notification, on the field and then on every ancestor group; `fieldKey` is the path relative to that group, `allValues` the whole form's values. The returned patch (or a promise of one) is applied to that group without formatters, setters or `onChange`; errors are swallowed.

**Child names.** On a group, config keys — `value`, `label`, `placeholder`, `description`, the four flags, `isInvalid`, `errorMessage`, `dirty`, `loading`, `validate`, `reset`, `resolve`, `deps`, `onSubmit`, `onEnter`, … — are never children: an object under such a key is read as that setting (a `value` key makes the node a leaf). `submitting`, `revalidate`, `values`, `submit`, `setValues` and `onValueChange` cannot name a group child: the constructor throws, naming the path. In a list template only structural keys are skipped (`label: { value: "" }` is a row field there), and a child named `loading`, `submitting`, `submit`, `values` or `dirty` throws when a row's fields are first read.

### `SubmitResult`

```typescript
type SubmitResult =
  | { success: true;  result?: unknown }                              // result: what onSubmit returned
  | { success: false; errors: Array<{ path: string; message: string }> };
```

`submit()` rejects instead of resolving when `onSubmit` (or another callback of the pipeline) throws.

### Recipes

```typescript
// Computed value
total: { value: (v: { price: number; quantity: number }) => v.price * v.quantity, isReadOnly: true },

// Computed chain — no declarations: each value tracks what it reads
tax:   { value: (v: { price: number }) => v.price * 0.2 },
total: { value: (v: { price: number; tax: number }) => v.price + v.tax },

// formatter — normalize on write
email: { value: "", formatter: (v: string) => String(v).trim().toLowerCase() },

// setter — cascade changes to other fields
country: { value: "US", setter: () => ({ city: "" }) },

// group onChange — react to any field change inside the group
passport: {
  onChange: ({ fieldKey }: { fieldKey: string }) => {
    if (fieldKey === "number") return { issueDate: "" };
  },
  number:    { value: "" },
  issueDate: { value: "" },
},

// group submit with validation
company: {
  onSubmit: async (values: { name: string; taxId: string }) => api.saveCompany(values),
  afterSubmit: (_result: unknown, { reset }: { reset: () => void }) => { showSuccessToast(); reset(); },
  name:  { value: "", isRequired: true },
  taxId: { value: "" },
},
```

---

## Async resolvers

> 🔗 **Source:** [config/catalog/](./app-demo/src/config/catalog), [modules/async-demo/](./app-demo/src/modules/async-demo) · **Live result:** [Demo → Async resolvers](https://projectint.github.io/palistor/#async)

`resolve` loads data asynchronously. It sits on a group (the result patches its fields), on a field (the result becomes its value) or on a list (the result becomes its rows — see [Lists & entities](#lists--entities)).

```typescript
const store = new Palistor({
  config: {
    userId: { value: "" },

    userInfo: {
      resolve: {
        // `values` holds the whole form's values: every value it reads becomes a dependency,
        // reads after an `await` included. When userId changes, the resolver runs again.
        // `store` gives access to the rest of the store; a store.context key it reads is a dependency too.
        resolver: async (values: { userId: string }, store: ProxyStore<any>) => {
          const data = await api.getUser(values.userId);
          return { name: data.name, email: data.email };
        },

        // Instant placeholder while the resolver is running
        optimisticResolver: () => ({ name: "Loading…" }),

        // `notify` is the store's notifier, `t` its translator: the message is built here, without a hook
        onError: (error: unknown, { notify, t }: { notify: NotifyFn; t: TranslateFn }) => {
          notify(t("errors.loadUser"), "USER_LOAD_ERROR");
        },

        deps: ["userId"],            // dependencies on every run, read or not
        contextDeps: ["accountId"],  // start a run only while store.context.accountId != null

        options: {
          lazy: true,      // wait for the first read of the node, `loading` included (default: true)
          suspense: false, // throw a promise for React Suspense (default: false)
          retry: { attempts: 3, delay: 1000 }, // 3 more tries after a failure, 1000 ms apart (delay default: 1000)
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

`loading` is `true` while the resolver runs and also while its first run is about to start: for an eager resolver (`lazy: false`) from the moment the store is created, for a lazy one from the first read of the node. Reading `loading` is such a read, so `if (form.userInfo.loading) return <Spinner />` shows the spinner in the very first render. A store created with `usePalistor` starts its runs after the component's first commit: until then they are about to start, and `loading` is already `true`. A resolver that still waits for its `contextDeps` reads `loading: false`. On the server no resolver runs, and a `suspense: true` node without data sends the fallback of its boundary — see [SSR & Next.js](#ssr--nextjs).

When a dependency changes, the resolve state resets, `optimisticResolver` applies instantly and the resolver runs again; a change while a run is in flight runs it once more after it lands. After success the dirty baseline is updated, so resolved data is not marked dirty.

- **`deps`** count as dependencies on every run, read or not: use them for a value read only conditionally, or for a node whose data came from `initialData` (its resolver has not run yet, so nothing has been tracked).
- **`contextDeps`** only gate the start: a run that would start while a listed key is `null` (the first one, a dependency change, a `reload()`) waits, keeping the last result. A key change does not re-run the resolver by itself — reading `store.context.accountId` in the resolver does (a node filled from `initialData` is the exception: until its first run it re-runs on a `contextDeps` key change). Row and entity resolves never wait; a paginated list ignores `contextDeps`.
- **`retry`**: `attempts` more tries after the first failure. `loading` stays `true` throughout, and `onError` runs once, after the last attempt.
- **Lists** ignore `retry` and `optimisticResolver`; `list.reload()` is their retry.
- Assigning to `values.x` inside the resolver is applied together with its result.

`onError(error, { notify, t })` gets the error and a context. `notify` calls the store's notification function (see [Notifications](#notifications)). `t` is the store's current translator — the one given to the constructor, to `<PalistorProvider>`, to `store.setTranslator` or to `useTranslator`: a stable reference that follows a later `setTranslator` and returns the key when no translator is registered. So an error message is built in the config, without a hook. The exported type `ResolveErrorContext` still declares only `notify`: annotate the parameter as above in a plain config object, or cast where the resolve is typed (see [Notifications](#notifications)).

---

## Lists & entities

> 🔗 **Source:** [modules/lists-demo/](./app-demo/src/modules/lists-demo) · **Live result:** [Demo → Lists & entities](https://projectint.github.io/palistor/#lists)

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
    resolver: async (values, store) => api.getUsers(values.search), // → Promise<User[]>
    deps: ["search"],
  },
});

const store = new Palistor({
  config: { search: { value: "" }, users },
});
```

Items are stored in a **normalized entity registry**: the same entity can appear in multiple lists and be rendered through different templates without duplication.

### List API

```typescript
const form = useForm(store);

// Read
form.users.items         // ReadonlyArray<entity node>
form.users.length        // number
form.users.loading       // boolean
form.users.dirty         // boolean — membership changed vs. baseline, here or in a nested list
form.users.error         // unknown | null — error thrown by the last resolve
form.users.resolveStatus // "idle" | "pending" | "resolved" | "error"
form.users.getValues()   // Array<plain object>
form.users.filter        // filter controls — a list with a `filter` block (see Filtering)
form.users.sort          // sort controls — a list with a `sort` block (see Sorting)

// Re-run the resolver (ignores the resolved-state dedup; no-op without a resolver)
form.users.reload();

// Iterate
form.users.map((item, index, id) => <Row key={id} item={item} />)
for (const item of form.users) { /* … */ } // current rows, but neither wakes a lazy list nor subscribes the component

// Mutate
form.users.add({ name: "Alice", email: "alice@ex.com" }); // object → upsert + append, returns the item node (tmp id if none)
form.users.add("existing-id");                            // string → append an entity already in the registry; returns undefined
form.users.remove("user-id");                             // out of this list only; store.delete(id) removes it everywhere
form.users.setItems(["id1", "id2", "id3"]);               // replace the membership: ids and/or rows (rows are upserted)
form.users.getById("user-id");                            // → item node | undefined
```

`add(id)` ignores an id that is not in the registry (a per-entity list throws) and never appends an id twice; `setItems` keeps the first of duplicate ids. The public type of `setItems` takes ids; rows are accepted at runtime.

On a list with a [filter](#filtering) or a [sort](#sorting), `items`, `length`, `map` and iteration show the visible rows in the visible order; `getById`, `getValues()`, `dirty` and `store.getValues()` keep the full membership in its own order. On a [paginated](#pagination) list they cover the current window, while `dirty` covers every cached page.

A list is `dirty` by composition: its membership differs from the loaded one, or a row of it owns a nested list that is dirty the same way, at any depth. So `add` / `remove` / `setItems` inside a nested list makes dirty the nested list, the row that owns it, the list that row belongs to, and the form (`form.dirty`). A row's field values take no part: editing a field makes the row dirty, not the list. `store.reset()` undoes the edits made inside nested lists and on paginated lists; a plain root list keeps its own `add` / `remove` / `setItems` (its `reload()` makes the loaded rows the baseline again). A successful `submit()` alone moves no baseline, for any kind of node: a nested chain is clean after the root's `afterSubmit: (_result, { reset }) => reset()` (on `store.submit()`), after `store.reset()`, or after the nested list's `reload()`; a group's own `reset()` leaves nested lists alone.

In TypeScript the elements of `items` (and the rows `map` hands you) are opaque `PalistorRef<User>`: pass a row to a component that reads it through `useForm(row)`, as below.

### Resolve state: loading / error / reload

`loading`, `error` and `resolveStatus` are projections of one resolve state, so they are always
coherent — and reactive: a component reading `error` re-renders when it appears and when it clears.

```tsx
function Users() {
  const form = useForm(store);
  const users = form.users;

  if (users.error) return <LoadError onRetry={() => users.reload()} />;
  if (users.loading) return <Spinner />;

  return <ul>{users.map((u, i, id) => <UserItem key={id} user={u} />)}</ul>;
}

function UserItem({ user }: { user: PalistorRef<User> }) {
  return <li>{useForm(user).name.value}</li>; // its own tracking scope: re-renders alone
}
```

`loading` is `true` while a run is in flight and also from the first read of the list until its
first run starts. Reading `loading` is itself such a read — it wakes the lazy resolver like `items`
does — so the component above renders the spinner in its very first render, on the server too (see
[SSR & Next.js](#ssr--nextjs)). `resolveStatus` stays `"idle"` until the run really starts.

`reload()` re-runs the resolver even after a successful load. On a plain list a `reload()` during a run
does nothing; on a paginated list it is `refetch()`: one new request that supersedes the one in flight.
Its identity is stable, so it is safe in a deps array or an `onRetry` prop. Works the same for root
lists and per-entity nested lists.

> **Groups don't expose `error` yet.** A group/flow resolver's failure is still reachable only
> through its `onError` callback; `error` / `resolveStatus` / `reload()` are list-only for now.

> **`error`, `resolveStatus` and `reload` are not `fieldMapping`-mappable** (`loading` is). They are
> matched before the mapping is applied, so a mapping such as `{ isInvalid: "error" }` does not shadow them: on a **field** `.error`
> stays the validation flag, on a **list** `.error` is the resolve error. The two never coexist on
> one node.

### Filtering

> 🔗 **Source:** [cube/contract/sliceE/](./cube/contract/sliceE) — the behavior described here, as tests; client fields in [app/lists/productsConfig.ts](./app-demo/src/app/lists/productsConfig.ts), server fields in [app/lists/orders/ordersConfig.ts](./app-demo/src/app/lists/orders/ordersConfig.ts) · **Live result:** [Demo → /lists](https://projectint.github.io/palistor/lists/), [/lists/orders](https://projectint.github.io/palistor/lists/orders/) (they reach the live demo with 0.1 — see [Demo](#demo); locally under `/palistor/lists/`)

A list takes a `filter` block next to its `resolve`. A **server field** is sent to the resolver and changing it fetches again; a **client field** (`where`) filters the rows already loaded and never fetches.

```typescript
interface Car { id: string; name: string; isNew: boolean }

const cars = defineList<Car>({
  template: { id: { value: "" }, name: { value: "" }, isNew: { value: false } },
  filter: {
    search:  { value: "", debounce: 300 },                       // server field: fetches 300 ms after the last change
    brand:   { value: null as string | null, param: "brand_id" }, // server field, sent as brand_id
    onlyNew: { value: false, where: (car: Car, on: boolean) => car.isNew === on }, // client field
  },
  resolve: {
    resolver: async (_values, _store, ctx) => api.cars(ctx.filter.params), // { search, brand_id }
  },
});
```

```tsx
function CarFilters() {
  const cars = useForm(store).cars;
  const filter = cars.filter!; // optional in the type: only a list with a block has it

  return (
    <>
      <Input {...filter.search} />                          {/* a filter field binds like a form field */}
      <Checkbox isSelected={filter.onlyNew.value} onValueChange={filter.onlyNew.onValueChange} />
      {filter.isActive && <button onClick={() => filter.clear()}>Clear ({filter.activeCount})</button>}
      <span>{cars.length} of {cars.fullLength}</span>
    </>
  );
}
```

- **Fields.** A field takes the leaf vocabulary (`value`, `label`, `formatter`, computed flags, `onChange`…) plus `where` (client field), `param` (rename the server param), `debounce` (ms) and `apply` (see ["Apply" mode](#apply-mode)). A literal is a shorthand: `search: ""` is `{ value: "" }`. A field whose `value` is a function is derived: read-only, not sent, not counted as active. Block options: `$all(row, filterValues)` — one more client rule, run last (see Client fields for when it runs); `$toParams(filterValues, context)` — build the params yourself; `$apply: "manual"` — see ["Apply" mode](#apply-mode).
- **The controls.** `list.filter.<field>` is a field node: `value`, `onValueChange`, `label`… A write runs formatter → setter → `onChange`. `filter.set(patch)` writes several fields (formatters run, setters and `onChange` don't), `filter.reset()` returns to the declared defaults, `filter.clear(field?)` writes the empty value. `filter.values` is a plain snapshot; `isActive` / `activeCount` count the non-empty fields; `isPending` is `true` while a debounced change waits.
- **Server fields.** After a change the resolver runs once; with `debounce` the run (not the value) waits, the timer restarts on every change, and typing then reverting within the delay sends nothing. A change without debounce — or `set` / `reset` / `clear` — sends at once, carrying the current values of the debounced fields too. The first run is never delayed. The resolver gets `ctx.filter`: `values` (every field), `params` (server fields under their `param` names, or what `$toParams` returned) and `key`. The request identity — `key`, and the query key of a paginated list — is built from the raw values of the server fields, not from what `$toParams` returns: two values that `$toParams` turns into the same params (`"acme"` and `"acme "` trimmed) are still two requests.
- **Client fields.** `where(row, value)` gets the raw row and is skipped while its field is empty; the rules add up (AND). A row added locally stays visible until the next resolve. `$all` runs only when the block has a client field, one that declares `where`: a field that only `$all` reads still needs `where: () => true`, otherwise it is a server field and every change calls the resolver.
- **What the list shows.** `items`, `map`, `length` and iteration show the visible rows, `fullLength` the full count; `getById`, `getValues()`, `dirty`, `store.getValues()` and submit keep the full membership.
- **Outside the form.** The filter is not in `getValues()`, `store.proxy.values`, submit payloads, persisted drafts or the resolver's `values`; `store.reset()` leaves it alone, and its `onChange` does not bubble to the form.
- **Pagination.** The server fields are part of the query key: a change starts again from the first page with one fetch, and with `maxCachedQueries > 1` going back to an earlier filter is served from the cache. Client fields filter only the current window.
- **Limits.** A filter on a list nested in a row is ignored (console warning). A field cannot take the name of a member of `list.filter` — `values`, `set`, `reset`, `clear`, `isActive`, `activeCount`, `isPending`, `apply`, `revert`, `isDraft`, `applied`: the store throws when it is created. The block is loosely typed: annotate the parameters of `where`, `$all`, `$toParams`.

#### "Apply" mode

> 🔗 **Source:** [app/lists/customers/customersConfig.ts](./app-demo/src/app/lists/customers/customersConfig.ts), [FilterPanel.tsx](./app-demo/src/app/lists/customers/FilterPanel.tsx); tests: [cube/core/filterApply.test.ts](./cube/core/filterApply.test.ts) · **Live result:** [Demo → /lists/customers](https://projectint.github.io/palistor/lists/customers/) (with 0.1, as above)

`$apply: "manual"` makes the fields of the block a draft: typing changes the field and its input, but neither the rows nor the requests. `filter.apply()` applies the drafts — an "Apply" button, Enter in a search box — and `filter.revert()` drops them. A field can override the block's mode with its own `apply: "auto"` or `apply: "manual"`.

```typescript
type Role = "admin" | "user";
interface Customer { id: string; name: string; role: string }

const customers = defineList<Customer>({
  template: { id: { value: "" }, name: { value: "" }, role: { value: "" } },
  filter: {
    $apply: "manual",                                   // the fields are a draft until filter.apply()
    search: "",
    role: { value: null as Role | null, param: "role_id" },
    quick: { value: "", apply: "auto", debounce: 300 }, // the exception: applied as it changes
  },
  resolve: {
    pagination: { pageSize: 20 },
    resolver: async (_values: unknown, _store: unknown, ctx: ListResolveContext) => api.customers(ctx.filter.params, ctx.page!),
  },
});
```

```tsx
function FilterPanel({ filter }: { filter: FilterProxyNode }) {
  const f = useForm(filter);

  return (
    <form onSubmit={(event) => { event.preventDefault(); f.apply(); }}> {/* Enter in a field submits */}
      <TextField field={f.search} />                        {/* shows the draft */}
      <RoleSelect field={f.role} />
      <button type="submit" disabled={!f.isDraft}>Apply</button>
      <button type="button" disabled={!f.isDraft} onClick={() => f.revert()}>Cancel</button>
      {f.isActive && <span>Filters: {f.activeCount}</span>} {/* counts the applied values */}
    </form>
  );
}
```

- **Draft and applied.** `filter.<field>.value` and `filter.values` show the drafts. Whatever acts on the list reads the applied values: the client rules (`where`, `$all`), `ctx.filter` (`values`, `params`, `key`), `$toParams`, `isActive` and `activeCount`. `filter.applied` is a snapshot of the applied values, one object per change. A derived field follows both: in `values` it is computed from the drafts, in `applied` and on the list from the applied values.
- **`apply()`** moves the drafts into the applied values: one notification and at most one request. With nothing to apply it does nothing, not even a notification. A paginated list goes back to its first page. A debounce of an automatic field that is still running stops, and its value goes out in the same request.
- **`revert()`** writes the applied values back into the fields — no formatter, no `onChange`, no request. A running debounce goes on.
- **`isDraft`** — a manual field's draft differs from its applied value, compared as `dirty` compares (`null` equals `undefined`, objects and arrays by content).
- **`set` / `reset` / `clear`** write the drafts of manual fields; only `apply()` applies them. A chip that drops one applied filter is `filter.clear("role"); filter.apply();` — one request, which also applies any other draft.
- **A mixed block.** A field with `apply: "auto"` applies as it changes, its `debounce` included, and its request carries the applied values of the manual fields, not their drafts. In an automatic block, a field with `apply: "manual"` is the only draft.
- **`initialData`** answers the applied values: a draft requests nothing, and the first request goes out with the `apply()` that changes them (or with a change of an automatic field).
- **Automatic mode** (no `$apply`): `apply()` and `revert()` do nothing, `isDraft` is `false` and `applied` is `values`. The four members are not enumerable: `Object.keys(filter)` and a spread of the filter do not list them.
- **Construction errors.** `debounce` on a manual field (typing in it sends nothing, so the option could never apply), `apply` on a derived field, a mode other than `"manual"` / `"auto"`, and a `$apply: "manual"` that reaches no field throw when the store is created.
- **Typing.** `useForm(filter)` takes `list.filter` handed down as a prop (`FilterProxyNode`) and returns the same node; the component re-renders on the filter's own state (`isDraft`, `applied`, `isActive`, …).

### Sorting

> 🔗 **Source:** client sort — [app/lists/productsConfig.ts](./app-demo/src/app/lists/productsConfig.ts), [ProductsTable.tsx](./app-demo/src/app/lists/ProductsTable.tsx); server sort with a HeroUI `Table` — [app/lists/orders/](./app-demo/src/app/lists/orders); tests: [cube/core/sort.test.ts](./cube/core/sort.test.ts), [sortServer.test.ts](./cube/core/sortServer.test.ts) · **Live result:** [Demo → /lists](https://projectint.github.io/palistor/lists/), [/lists/orders](https://projectint.github.io/palistor/lists/orders/), [/lists/feeds](https://projectint.github.io/palistor/lists/feeds/) (they reach the live demo with 0.1 — see [Demo](#demo); locally under `/palistor/lists/`)

A list takes a `sort` block next to its `filter`. `sort: true` makes every field of the template sortable, and `list.sort` holds the state and the actions. The base case is a click on a column header:

```typescript
interface Product { id: string; title: string; price: number; inStock: boolean; rating: number | null }

const products = defineList<Product>({
  template: {
    id: { value: "" }, title: { value: "" }, price: { value: 0 },
    inStock: { value: true }, rating: { value: null },
  },
  sort: true, // every field of the template sorts by its value
  resolve: { resolver: async () => api.products() },
});
```

```tsx
import type { ReactNode } from "react";
import { useForm, type PalistorList, type SortKey, type SortProxyNode } from "palistor";

type ProductKey = SortKey<Product>; // "id" | "title" | "price" | "inStock" | "rating"

function ProductsTable({ products }: { products: PalistorList<Product> }) {
  const list = useForm(products);
  const sort = list.sort!; // optional in the type: only a list with a block has it

  return (
    <table>
      <thead>
        <tr>
          <SortHeader sort={sort} column="title">Title</SortHeader>
          <SortHeader sort={sort} column="price">Price</SortHeader>
        </tr>
      </thead>
      <tbody>{list.map((row, _index, id) => <ProductRow key={id} product={row} />)}</tbody>
    </table>
  );
}

function SortHeader({ sort, column, children }: { sort: SortProxyNode<ProductKey>; column: ProductKey; children: ReactNode }) {
  const s = useForm(sort);     // its own scope: a sort change re-renders the headers, not the rows
  const dir = s.dirOf(column); // "asc" | "desc" | null

  return (
    <th aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}>
      <button onClick={() => s.toggle(column)}>
        {children}{dir === "asc" ? " ▲" : dir === "desc" ? " ▼" : ""}
      </button>
    </th>
  );
}
```

`toggle(column)` steps through none → ascending → descending → back to where the list started: its own order, or `$default` when the block has one. This list has no pagination, so it holds all its rows and sorts them in the browser: a sort change calls no resolver. The table component re-renders when the order changes, the headers when the sort does; a row re-renders only when its own values change.

```typescript
const sort = list.sort!;

sort.by               // [{ key, dir }] — empty without a sort
sort.key              // the first entry's key, or null
sort.dir              // "asc" | "desc" | null
sort.keys             // the sortable keys
sort.dirOf("price")   // "asc" | "desc" | null
sort.toggle("price"); // none → asc → desc → back to $default (to no sort without one)
sort.set("price", "desc"); // the direction defaults to "asc"
sort.clear();         // no sort: the list's own order
sort.reset();         // back to $default (no sort without one)
sort.refresh();       // order the rows again by their current values (client sort)
sort.sortDescriptor   // React Aria / HeroUI Table, see below
sort.onSortChange
```

The options of the block:

```typescript
interface Customer { id: string; firstName: string; lastName: string; priority: "low" | "high" | "urgent"; createdAt: string }

const RANK = { low: 0, high: 1, urgent: 2 };

const customers = defineList<Customer>({
  template: {
    id: { value: "" }, firstName: { value: "" }, lastName: { value: "" },
    priority: { value: "low" }, createdAt: { value: "" },
  },
  sort: {
    $default: "-createdAt", // the sort at creation and after reset(); "-" is descending
    $locale: "en",          // the locale of the string comparison (set it under SSR)
    createdAt: true,        // by the field's value: an ISO string sorts by time
    lastName: { by: (row: Customer) => `${row.lastName} ${row.firstName}` },                  // by a value computed from the row
    priority: { compare: (a: Customer, b: Customer) => RANK[a.priority] - RANK[b.priority] }, // your own order of two rows
  },
  resolve: { resolver: async () => api.customers() },
});
```

- **The block.** `true`, or an object: a key that starts with `$` is an option, any other key is a field. A block that names no field (`true`, or only options) makes every leaf of the template sortable, a leaf in a nested group by its path (`"address.city"`); a block that names fields sorts only by those. A field is `true` (by its value), `{ by }` (by a value computed from the row) or `{ compare }` (your own order of two rows; `"desc"` reverses it). `$default` is `"key"` or `"-key"`: the sort the list starts with, where the third press of `toggle` returns, and what `reset()` restores.
- **Construction errors.** Config that can never apply throws when the store is created: an unknown `$` option or field option, `$default` on a key that does not sort, a sort by value on a key that is not a leaf of the template, `by` together with `compare`, `{ param }` on a list that sorts itself, and on a list the server sorts `{ by }`, `{ compare }` or `$locale`; `$server: false` on a paginated list and `$server: true` on a list without a resolver. `toggle`, `set` and `onSortChange` throw on a key that does not sort.
- **The comparison.** Numbers as numbers; strings through `Intl.Collator` with `numeric: true` and `sensitivity: "base"` — "Item 2" before "Item 10", case and accents ignored; `false` before `true`; values of different types as text. Empty values — `null`, `undefined`, `""`, `NaN`, a key the row lacks — go last in both directions. The sort is stable: equal rows keep the list's order in both directions — `"desc"` negates the comparison instead of reversing the result — and empty values stay last. A `Date` does not survive in a row of the registry: keep dates as ISO strings or timestamps, or return a `Date` from `by`.
- **The order is a snapshot.** The rows are put in order when the sort changes (`toggle`, `set`, `clear`, `reset`, `onSortChange`), when a resolve lands, when `setItems` or a restore (`initialData`, a persisted draft) replaces the membership, and on `sort.refresh()`. In between no value is compared: a row that joins the list (`add`, a row from a realtime update) goes to the end, a value edit moves no row (`items` keeps its array), a removed row leaves and the rest stay in place, `store.rekey` keeps the row's place. So the header can show ▲ above a row that no longer fits: call `sort.refresh()` after saving an edit to a sorted column, after a batch of realtime updates, or from a "Re-sort" button. A `refresh()` with nothing to move notifies nothing.
- **A projection.** The visible rows are the sort over the filter over the membership: the client filter narrows the ordered rows and keeps their order. `items`, `map`, `length` and iteration follow it; `getById`, `getValues()`, `dirty`, `store.getValues()` and submit keep the list's own order, so a sort never makes a list dirty. Pages on the client are `list.items.slice((page - 1) * size, page * size)`: filter, then sort, then the page, over all the rows.
- **Outside the form.** The sort is not in `getValues()`, submit payloads, persisted drafts or the resolver's `values`; `store.reset()` leaves it alone.
- **SSR.** Without `$locale` the collator takes the default locale of the environment. The server and the browser may have different ones, and then non-ASCII strings come out in a different order and hydration fails. Under SSR give a list that sorts in the browser a `$locale`.
- **Limits.** One column at a time: `set` and `toggle` replace the sort. Root lists only: a `sort` on a list nested in a row is ignored (console warning).
- **Typing.** `list.sort` is optional in the list type (`list.sort!`), as `filter` is. On a `defineList<Product>` list it is `SortProxyNode<SortKey<Product>>`, so `toggle("nope")` is a type error. `SortKey<T>` is the leaves of `T`, nested ones as dotted paths, arrays left out; for a flat entity it equals `keyof Product & string`. The keys of the block are checked the same way, and `by` / `compare` get the row typed. A field with `{ by }` or `{ compare }` must be named after a leaf of the entity in the types, although any name works at run time. `useForm(sort)` takes the node handed down as a prop and returns the same `SortProxyNode<K>`; `store.proxy.products.sort` passed to `useForm` throws, like any raw node.

**HeroUI / React Aria `Table`.** `sortDescriptor` and `onSortChange` have the shapes `Table` takes. Here they sit on the `orders` list of [Server-side sorting](#server-side-sorting) below; a list sorted in the browser plugs in the same way:

```tsx
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from "@heroui/react";

function OrdersTable({ orders }: { orders: PalistorList<Order> }) {
  const list = useForm(orders);
  const sort = list.sort!;

  return (
    <Table aria-label="Orders" sortDescriptor={sort.sortDescriptor} onSortChange={sort.onSortChange}>
      <TableHeader>
        <TableColumn key="title" allowsSorting>Title</TableColumn>
        <TableColumn key="amount" allowsSorting>Amount</TableColumn>
      </TableHeader>
      <TableBody>
        {list.map((order, _index, id) => (
          // the row stays a TableRow; OrderCell calls useForm(order)
          <TableRow key={id}>
            <TableCell><OrderCell order={order} column="title" /></TableCell>
            <TableCell><OrderCell order={order} column="amount" /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

`sortDescriptor` is `undefined` while nothing is sorted, and one object per state. `onSortChange` follows the `toggle` cycle: a press on the sorted column asks for the other direction, and the press after descending returns to `$default` (no sort without one); a press on another column sorts it in the direction React Aria sends. The body of a HeroUI `Table` is a React Aria collection and does not take a row component of your own: keep `TableRow` / `TableCell` and call `useForm(row)` in a component inside the cell.

#### Server-side sorting

A list that holds one page cannot sort its rows itself. A list with `resolve.pagination` sends its sort to the resolver; `$server: true` does the same for a list without pagination whose resolver returns "the first N in this order". The block and `list.sort` are the same; a field takes `true` or `{ param }` — the name the server gets, the key by default.

```typescript
interface Order { id: string; title: string; amount: number; createdAt: string }

const orders = defineList<Order>({
  template: { id: { value: "" }, title: { value: "" }, amount: { value: 0 }, createdAt: { value: "" } },
  sort: { $default: "-createdAt", title: true, amount: true, createdAt: { param: "created_at" } },
  resolve: {
    pagination: { pageSize: 20 },
    resolver: async (_values: unknown, _store: unknown, ctx: ListResolveContext) => {
      const order = ctx.sort.by.map((s) => (s.dir === "desc" ? `-${s.param}` : s.param)); // ["-created_at"]
      const r = await api.orders({ order, offset: ctx.page!.offset, limit: ctx.page!.pageSize });
      return { items: r.rows, total: r.count };
    },
  },
});
```

- **`ctx.sort`** is `{ by: [{ key, param, dir }], key }`, `key` being the request identity of `by`. It is `{ by: [], key: "" }` when nothing is sorted, for a list that sorts itself and for a list without a block: every list resolver gets it, and the package's `ListResolveContext` declares it required. `ctx.queryKey` of a list without a server sort is what it was before.
- **One request per change.** A list with `$server: true` runs its resolver again; changes made while a run is in flight cause one more run after it, with the latest state. A paginated list adds the sort to its query key and goes back to its first page with one request; with `maxCachedQueries > 1` a sort still in the cache comes back without a request, `keepPreviousData` keeps the rows on screen (`isPreviousData`), and an `infinite` list starts its window over. A list that has not loaded yet sends nothing: its first load carries the current sort.
- **The server's order.** The list shows the rows in the order they came and never reorders them: `refresh()` does nothing here, and an added row stays where `add` put it.
- **With a filter.** The sort and the server fields of the filter make one request identity. A sort change while a filter field's debounce is running sends one request that carries the pending value too, and nothing more when the debounce runs out. Two writes in one handler are two requests: `filter.set({ … })` or `filter.apply()` followed by `sort.toggle(…)` sends twice — there is no public way to batch them.
- **`initialData`** answers the sort the store starts with (`$default`): pass the rows in that order, and nothing is requested after construction; a sort change is one request (for the first page).
- **Persist.** The sort is never saved. A paginated list's window saved under another sort is not restored: the store starts at `$default` and fetches it.

### Pagination

> 🔗 **Source:** [modules/lists-demo/OrdersSection.tsx](./app-demo/src/modules/lists-demo/OrdersSection.tsx); `prefetch`, `setPageSize`, `keepPreviousData`, `maxCachedQueries` in [app/lists/orders/](./app-demo/src/app/lists/orders); `infinite`, `maxPages`, a persisted window, `cursor` and `suspense` in [app/lists/feeds/](./app-demo/src/app/lists/feeds) · **Live result:** [Demo → Lists & entities](https://projectint.github.io/palistor/#lists), [/lists/orders](https://projectint.github.io/palistor/lists/orders/), [/lists/feeds](https://projectint.github.io/palistor/lists/feeds/) (the `/lists` routes with 0.1 — see [Demo](#demo))

A list fetches **one page at a time** and caches every page it has seen. Add a `pagination` block to
`resolve` — its presence is the only switch. The resolver gets the page request as `ctx.page` and
returns `{ items, total }`. A bare array still works: `total` then stays `undefined`, `pageCount`
counts the contiguous fresh cached pages from the first one and `hasNextPage` follows a full page.

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
        offset: ctx.page!.offset,           // (page − base) × pageSize; infinite: the rows fetched so far
        limit: ctx.page!.pageSize,
        cursor: ctx.page!.cursor,           // cursor / infinite modes
      });
      return { items: r.rows, total: r.count, nextCursor: r.next }; // PagedResult
    },
  },
});
```

**Switching to a cached page that is still fresh never calls the resolver** — it is a synchronous
projection (past `staleTime` the page is shown and revalidated in the background). Only a miss, a
stale page or a change in what the resolver read (search, filters, a server sort, `store.context`, …) does: that is a
new *query key*, so the old pages are invalidated and the first page is fetched exactly once. The same values
written back unchanged are a strict no-op.

```typescript
const list = form.orders; // the pagination members are optional in the list type: list.setPage!(n) under strict TS

// Reactive getters (a Pager reading only page / pageCount re-renders on setPage)
list.page            // current page (honors `base`, default 1)
list.pageSize
list.pageCount       // from the server total, else the number of contiguous fresh cached pages
list.total           // DISPLAY total: server total ± local optimistic adds/removes
list.serverTotal     // raw server total — moves only on fetch / delete / confirmed add
list.hasNextPage     // never fooled by an optimistic add
list.hasPrevPage
list.isFetching      // any page fetch in flight (`loading`: this, or the first fetch about to start)
list.isInitialLoading // fetching, or about to fetch, with nothing cached yet — skeleton vs. spinner;
                     // reading it wakes the lazy list, as `loading` and `items` do
list.isPreviousData  // `keepPreviousData`: the rows on screen belong to the previous query
list.isStaleFromStorage // the window came from storage already past staleTime and is not revalidated yet
list.pendingAdds     // ids of un-flushed optimistic adds (restored from storage or not)

// Navigation
list.setPage(n);     // cached & fresh → synchronous; otherwise one fetch
list.nextPage();  list.prevPage();
list.prefetch(n);    // warm the cache without moving the pointer (hover); returns a Promise
list.setPageSize(n); // clears the cache, fetches the first page once

// Freshness — always at most ONE request
await list.refetch();   // paged: the whole query goes stale, the current page refetches now;
                        // infinite / cursor: pull-to-refresh — back to the first page
list.invalidate();      // paged: every page stale, the current one refetches now;
                        // cursor: back to the first page, refetched; infinite: the window shrinks
                        // to the first page, marked stale, no request
list.invalidate(3);     // one page — paged: stale, refetched now if current; cursor: later pages dropped,
                        // the pointer moves back to it, refetched; infinite: later pages dropped, no request
list.discardPendingAdds(); // drop un-flushed optimistic rows (escape from a permanently dirty list)

// infinite mode
list.loadMore();            // append the next page (cache hit ⇒ no fetch; no-op while one is in flight)
list.isFetchingNextPage     // a footer spinner, distinct from isInitialLoading
list.loadedPages            // [{ ordinal, ids }] — for section-header UIs

// infinite and cursor modes
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
offset; `setPage` does nothing there (a console warning, once), and `setItems` throws in development
and warns in production. `cursor` — one
page on screen, sequential access through `nextCursor`: `setPage(n)` reaches a cached page or the next
one, and `prevPage` is free while that page is fresh.

**The end of a feed.** In `infinite` and `cursor` modes a page returned with an explicit
`nextCursor: null` is the last one: `hasNextPage` is `false`, `loadMore()` and `nextPage()` request
nothing, and in `cursor` mode neither do `setPage(next)` and `prefetch(next)`. The explicit `null` wins
over `total`, over `hasMore: true` and over a full page. A page without the field says nothing about
the end: `total`, `hasMore` or a full page decide. So a feed that continues by offset must omit
`nextCursor`, not send `null`. A first page given as `initialData` (`{ items, nextCursor: null }`)
follows the same rule.

**Local edits vs. the cache.** `add / remove / setItems` mutate the cached page they land on (`add`:
the current page, in `infinite` the last loaded one; `setItems`: the current page only); the visible
window is always a projection of the pages. `dirty` is the aggregate over every cached page, so an
un-flushed add parked on an off-screen page keeps the list dirty, and so does an edit in a nested list
of a row on such a page. `store.reset()` rolls back the edits of every cached page and keeps the
navigation (no request); a group's `reset()` leaves the pages alone. `store.rekey(tmp, real)` reaches every cached page and promotes the confirmed row into
server truth; `store.delete(id)` splices it out of every page, and for a server row marks the later
pages stale (paged / cursor) or shifts the continuation offset (infinite). A
deleted row on a `paged` list is replaced on screen by the head of the next cached page until that
page is refetched.

| `pagination` option | Default | Meaning |
|---|---|---|
| `pageSize` | — | required |
| `mode` | `"paged"` | `"paged"` \| `"infinite"` \| `"cursor"` |
| `base` / `initialPage` | `1` / `base` | page numbering (`base` is 0 or 1) |
| `staleTime` | `Infinity` | ms a cached page is served without a background refetch (stale-while-revalidate) |
| `maxCachedQueries` / `gcTime` | `1` / `Infinity` | how many query keys are retained (flip back to an old filter ⇒ cache hit) and for how long |
| `maxCachedPages` | `Infinity` | LRU cap on cached pages per query (the visible window is never evicted) |
| `maxPages` | `Infinity` | `infinite`: the window keeps at most this many pages — the oldest leave memory, the continuation offset survives |
| `keepPreviousData` | `false` | keep the previous query's rows on screen while the first page of the new one loads (`isPreviousData`). Meanwhile `page`, `pageCount`, `total` and `hasNextPage` already describe the new query — page 1, no total yet — so hide or disable the pager while `isPreviousData` |
| `persist` | `{ maxPages: 3 }` | what reaches storage: a bounded tail, `"window"` (everything + the scroll anchor), or `false` |
| `persistPendingAdds` | `"keep"` | un-flushed optimistic adds survive a reload (`"drop"` to discard) |
| `revalidateOnHydrate` | `"first"` | what a restored, expired window revalidates after paint (`"none"` \| `"first"` \| `"all"`) |
| `queryKey(values, context)` | auto | escape hatch when the auto-tracked dependency values are not serializable; replaces the automatic key |

**Persist.** With `usePersist` / `store.persist` the current page (and, for `infinite`, the tail of the
window) of a root list is restored on reload and served without a request — but only when the saved
query still matches the live values and context (a window saved for tenant A is never served to tenant
B), and only when the restore lands before the list's first fetch: `await store.persist.enable(…)`
before anything reads the list. `usePersist` hydrates in an effect, asynchronously, so on a `usePalistor`
store — which starts after the first commit and fetches the page the render read — one request goes
out first, and the restored window then takes the place of its result. With `persist: "window"` call
`list.setScrollAnchor(id)` from an IntersectionObserver and read `list.scrollAnchor` after hydrate to
restore the scroll position. `setScrollAnchor` changes no state, so the anchor reaches storage with the
next change of the store; call `store.persist.flush()` after it to save it now. A paginated list nested
in a row comes back with its owner's rows, and its page cache is fetched again.

**Nested lists.** The same `pagination` block on a list inside an entity template paginates **each
per-entity instance independently** (`user.orders.setPage(2)`), with its own cache and query key. The
resolver receives the owner's values as the first argument — the owner fields it reads become its
dependencies, so editing `user.region` re-keys only that user's list.

**Context.** A paginated list ignores `contextDeps`. A `store.context` key the resolver reads is part of
the query key; to key on one before the first run, name it in `deps` as `"$context.tenantId"`.

**Suspense.** `resolve.options.suspense: true` makes `items` / `map` / `length` throw the in-flight
promise while the list has nothing to render (the first page, or a query change without
`keepPreviousData`); a page navigation or `loadMore` never suspends the rows already on screen.

### List item — properties

Every element of `form.users.items` is an entity node seen through the template. In TypeScript it is an opaque `PalistorRef`; `useForm(row)` in a row component returns the typed node:

```typescript
const item = useForm(user); // user: PalistorRef<User>, an element of form.users.items

item.id             // string — entity id (moves on store.rekey)
item.name.value     // field value through the template
item.name.label     // computed label from the template
// …all leaf props: value, label, placeholder, description, isRequired, isReadOnly, isDisabled,
//   isVisible, isInvalid, errorMessage, dirty, loading, onValueChange

item.dirty          // boolean — a field of this row changed, or a list nested in it is dirty
item.values         // the row's values (an object of getters, like a group's values)
item.loading        // boolean — on the node useForm(entity, template) returns: its template resolve
                    // is running; on a list row it stays false
item.submitting     // boolean — a submit is running for this entity
await item.submit(); // → SubmitResult — the template's validate rules, then its onSubmit
```

In a row, a field's `formatter` applies on write and its `validate` drives `isInvalid` / `errorMessage` live, without a submit; `isRequired` is a display flag only. A field's own resolve shows on `item.<field>.loading`. `item.submit()` calls the template's `onSubmit(entityNode, store)` — the node, not a plain payload — without `beforeSubmit`. A template cannot have a computed `value`; its `id` field is shadowed by `item.id`.

**Nested lists.** A list declared inside a template is a per-entity list: every row owns its own instance, read from the row (`item.orders`) through the same list API. Its resolver receives the owner's values. A nested list gets its rows from its own resolver, from `setItems` / `add`, or from `initialData`. The resolver of the list above does not fill it: a nested array inside a row that a resolver returns is not the nested list's membership. `initialData` and a persisted draft do fill nested lists from the rows (see [SSR & Next.js](#ssr--nextjs)).

**`store.reset()` and rows.** A full `store.reset()` requests nothing for rows. A nested list and a row field whose resolve has its result stay resolved: the list's membership returns to what the resolver (or `initialData`) loaded, `loading` is `false`, and the next read does not call the resolver — as with a root list. The reset also reaches the nested lists of rows that are off screen (on another cached page of a paginated list). A resolve that was in flight or had failed when the reset came starts over on its next read. To fetch a nested list again on purpose, call its `reload()`.

### Rendering an entity through another template

Bind an entity to any template group (e.g. an edit form) with the two-argument `useForm`:

```tsx
function UserRow({ user }: { user: PalistorRef<User> }) {
  const u = useForm(user, (s) => s.editUserForm);
  return <span>{u.name.value}</span>;
}
```

On mount the entity is bound to the template, and the template's resolver runs once per entity+template pair (cached) as `resolver(entityNode, store)` — without auto-tracking, `deps`, retry or an optimistic value; its result is merged into the row. `store.invalidate(id, templateConfig)` forgets the cached run, so the next mount of `useForm(entity, template)` runs the resolver again.

### Working with entities directly

```typescript
// Create / update entities (single or batch — one notification; a recursive merge)
store.set({ id: "u1", name: "Bob" });
store.set([{ id: "u1" }, { id: "u2" }]);

// A row without an id gets a temporary one (_tmp_…, readable as the row node's `id`).
// For an optimistic add it is simpler to give your own temporary id…
form.users.add({ id: "tmp-1", name: "Ann", email: "" });
// …and rekey it after the server assigns the real one:
store.rekey("tmp-1", serverAssignedId);

// Remove an entity (children owned by it are removed in cascade)
store.delete("u1");
```

---

## Flows (step wizards)

> 🔗 **Source:** [config/flow.ts](./app-demo/src/config/flow.ts), [modules/flow-demo/](./app-demo/src/modules/flow-demo) · **Live result:** [Demo → Flows](https://projectint.github.io/palistor/#flow)

`defineFlow` / `defineStep` build a step wizard on top of regular group nodes: navigation state, step statuses, branching and per-step validation.

```typescript
import { defineFlow, defineStep, Palistor } from "palistor";

interface Nav { nextStep: () => void }
interface OnboardingValues { plan: { plan: string } }

const onboarding = defineFlow({
  steps: [
    defineStep("account", {
      fullName: { value: "", isRequired: true },
      email:    { value: "", isRequired: true },
      // The third onSubmit argument is the flow node — navigation methods are bound,
      // so destructuring works. A step's submit validates the step first.
      onSubmit: (_values: unknown, _store: unknown, { nextStep }: Nav) => nextStep(),
    }),

    defineStep("plan", {
      plan: { value: "", isRequired: true },
      onSubmit: (_values: unknown, _store: unknown, { nextStep }: Nav) => nextStep(),
    }),

    // Branching: a hidden step is skipped by nextStep() and excluded from
    // final validation.
    defineStep("company", {
      isVisible: (values: OnboardingValues) => values.plan.plan === "enterprise",
      companyName: { value: "", isRequired: true },
      onSubmit: (_values: unknown, _store: unknown, { nextStep }: Nav) => nextStep(),
    }),

    defineStep("summary", {}), // read-only summary step
  ],

  // Flow-level finalization — runs through the standard submit pipeline
  // (defineFlow also takes beforeSubmit / afterSubmit)
  onSubmit: async (allValues, store) => api.completeOnboarding(allValues),
});

const store = new Palistor({ config: { onboarding } });
```

### Flow node API

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
flow.steps.current     // node of the active step
flow.steps.account     // by key
flow.steps[0]          // by index
flow.steps.length      // number of steps
[...flow.steps]        // iterable

// Step node = regular group node + status
flow.steps.account.status   // "active" | "completed" (visited before) | null (never visited)
flow.steps.account.email    // field node — regular leaf

// Navigation
flow.nextStep();        // next VISIBLE step; if none ahead → finalize via flow.submit()
flow.back();            // pop the visit stack; no-op when empty
flow.goTo("plan");      // jump by key or index; the step left goes onto the back stack
flow.validate();        // validate visited visible steps → returns the errors, sets flow.errors

// Values & finalization
flow.values             // accumulated values of all steps, keyed by step
await flow.submit();    // standard pipeline; hidden steps' errors are filtered out
```

- `nextStep()` does not validate the step it leaves: call it from the step's `onSubmit`, as above, to move on only when the step is valid. When no visible step is ahead it finalizes fire-and-forget: navigation stays put and the errors land in `flow.errors`.
- `goTo()` throws on an unknown key or an out-of-range index, does nothing for the active step, and does not skip hidden steps.
- `validate()` checks the visited visible steps (hidden fields skipped) and does not reveal field errors: `errorMessage`s stay hidden until a submit.
- `"completed"` means visited before and not active — not necessarily valid or submitted.
- A hidden step is skipped by `nextStep()` and excluded from the final validation, but its values stay in `flow.values` and in the `onSubmit` payload: drop them in `beforeSubmit` or `onSubmit` if needed.
- The flow node is a group node too: `loading` (a step is loading), `dirty`, `isInvalid` (visited visible steps), `revalidate`, `reset()`. A flow can sit inside a group. Step keys cannot take the flow's own names (`values`, `steps`, `current`, `length`, the navigation names…), and a step cannot have a field named `status`.

### Step lifecycle

A step config accepts two flow-specific callbacks in addition to everything a group supports:

```typescript
defineStep("details", {
  onEnter: (flowValues: unknown, store: ProxyStore<any>) => { /* fired on entering the step */ },
  onReady: (flowValues: unknown, store: ProxyStore<any>) => { /* fired after the step's resolve settles */ },
  resolve: { resolver: async () => api.getDetails(), onError: () => {} },
  // …fields
})
```

On entering a step: `onEnter → resolve (triggered eagerly) → onReady`. `onEnter` fires on every entry. `onReady` fires when the step's resolve settles — after a success or an error — so once per resolve run: a step re-entered with a cached resolve gets `onEnter` but no new `onReady`; a step without `resolve` gets `onReady` on every entry. Both are fire-and-forget: a throw never blocks navigation. The first step of every flow is entered when the store starts: in the constructor for `new Palistor()`, after the component's first commit for `usePalistor`. Until then — and in server mode, where nothing starts — no callback is called, and a first step with `resolve` reads `loading: true` (see [SSR & Next.js](#ssr--nextjs)). `reset()` of the flow (or any ancestor) resets navigation to the first step and re-runs the entry lifecycle, step resolves included.

Flow navigation (current step, history) is included in [persist](#persist) snapshots and restored on hydration. Note that a successful submit of a group clears the snapshot — a step's `submit()` included.

---

## Field mapping

> 🔗 **Source:** [config/fieldMapping.ts](./app-demo/src/config/fieldMapping.ts), [modules/field-mapping/](./app-demo/src/modules/field-mapping) · **Live result:** [Demo → Field mapping](https://projectint.github.io/palistor/#mapping)

`fieldMapping` renames field-state props **at the node boundary** — reads, writes, tracking and spread — so `{...form.email}` carries the props under your UI kit's names (MUI, Ant Design, plain HTML). The engine inside is unchanged.

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
  // Writing an internal name (isRequired) of a remapped key is a type error and throws.
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
  return (
    <TextField
      {...form.email} // required / error / helperText — as MUI expects
      onChange={(e) => form.email.onValueChange(e.target.value)} // MUI passes an event, not a value
    />
  );
}
```

Mappable keys: `value`, `label`, `placeholder`, `description`, `isRequired`, `isReadOnly`, `isDisabled`, `isVisible`, `isInvalid`, `errorMessage`, `dirty`, `loading`, `onValueChange`. Without `fieldMapping` there is zero overhead and no behavior change.

- The spread carries `value`, `label`, `placeholder`, `description`, the four flags, `isInvalid`, `errorMessage` (under their mapped names, where mapped), `onValueChange(value)` and the `componentProps` keys; `dirty` / `loading` are readable under their mapped names but not spread (a list row's field spreads them too). An event-based input needs `onChange={(e) => form.email.onValueChange(e.target.value)}` (or an adapter component), and the props you do not map reach the component under their own names.
- A config may use only the input names: `value`, `label`, `placeholder`, `description` and the four flags. `isInvalid`, `errorMessage`, `dirty`, `loading` and `onValueChange` are output-only; writing their external name in a config throws. A rename onto a reserved list key (`filter`, `values`, `page`, `total`, …) throws at construction.
- Internal names stay readable at runtime off the spread (the types hide them). Child keys, `getValues()` and submit payloads are never renamed.

> Use `defineFieldMapping` (or `as const`) for a reusable map — a plain `: FieldMapping` annotation or `satisfies FieldMapping` widens the literals to `string` and the static renaming is lost.

---

## Persist

> 🔗 **Source:** [modules/payment-form/PaymentForm.tsx](./app-demo/src/modules/payment-form/PaymentForm.tsx) (`usePersist`), [PersistControls.tsx](./app-demo/src/modules/payment-form/PersistControls.tsx) · **Live result:** [Demo → Payment Form](https://projectint.github.io/palistor/#form)

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

The hook hydrates on mount, autosaves on change, and flushes + disables on unmount. Hydration is asynchronous even with a synchronous driver, so it lands after the first render. Changing `key` or `driver` saves under the old key and hydrates from the new one; other option changes apply only on such a reconnect.

### Outside React

```typescript
import { localStorageDriver } from "palistor";

await paymentStore.persist.enable({ key: "payment", driver: localStorageDriver }); // resolves after hydration
await paymentStore.persist.flush();   // force save (a no-op while hydration is in flight)
await paymentStore.persist.hydrate(); // read the storage again
await paymentStore.persist.clear();   // delete the snapshot
paymentStore.persist.isEnabled();     // → boolean
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

The built-in `localStorageDriver` / `sessionStorageDriver` do nothing where there is no storage (on the server) and pass a quota error to `onError`.

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
| `onError` | `(error, phase: "save" \| "hydrate") => void` | — | Called when a save or a hydration fails (otherwise errors are swallowed) |

**What a snapshot holds.** The values (after `pick` / `omit`), list membership including nested lists, each flow's navigation (always, whatever `pick` / `omit` say) and the windows of paginated root lists (when their array survives `pick` / `omit`). Filters are never saved. A custom `serialize` / `deserialize` must round-trip the service keys `__flows` and `__pagination` as well. Hydration applies the raw values — no formatter, setter or `onChange` — in one notification.

**A successful submit clears the snapshot.** A successful `submit()` of the store or of any group — a flow step and the flow included — deletes the snapshot; it is written again after the next change. A leaf or entity submit keeps it.

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

In the config, translatable strings are functions of `(t, values)`; a static string is shown as written:

```typescript
cardNumber: {
  value: "",
  label:       (t: TranslateFn) => t("fields.cardNumber.label"),
  placeholder: (t: TranslateFn) => t("fields.cardNumber.placeholder"),
},
```

The `validate` callback receives `t` as its third argument, and the flag functions (`isVisible`, `isRequired`, …) as their second. Without a registered translator the functions receive an identity `t`, so a label function returns its key — convenient for tests.

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

`useTranslator` registers the function in an effect, after mount: the server HTML and the first client render do not have it yet. To translate from the first render, give the function to the constructor — `new Palistor({ config, translator: t })` — or to `<PalistorProvider translator={t}>`, which hands it to every store created with `usePalistor` below (see [SSR & Next.js](#ssr--nextjs)). On unmount `useTranslator` unregisters: labels fall back to their keys, even when a translator was given to the constructor.

---

## Notifications

> 🔗 **Source:** [config/catalog/catalogConfig.ts](./app-demo/src/config/catalog/catalogConfig.ts) · **Live result:** [Demo → Async resolvers](https://projectint.github.io/palistor/#async)

Register a toast/alert function once; resolvers receive it in `onError` via `ctx.notify`:

```tsx
import { useCallback } from "react";
import { useNotifier } from "palistor";

function RootLayout({ children }: { children: React.ReactNode }) {
  const notifyError = useCallback((message: string, code?: string) => {
    addToast({ title: message, description: code, color: "danger" });
  }, []);

  useNotifier(paymentStore, notifyError);
  return <>{children}</>;
}
```

The function can also be given to the constructor (`notifier`), to `<PalistorProvider notifier>` or to `store.setNotifier`. `useNotifier` registers it after mount and unregisters it on unmount. Without a notifier, `notify` does nothing.

`onError` gets the function in its context, together with the store's translator `t`:

```typescript
import { defineList, type ResolveErrorContext, type TranslateFn } from "palistor";

interface User { id: string; name: string }

const users = defineList<User>({
  template: { id: { value: "" }, name: { value: "" } },
  resolve: {
    resolver: async () => api.getUsers(),
    onError: (error: unknown, ctx: ResolveErrorContext) => {
      const { notify, t } = ctx as ResolveErrorContext & { t: TranslateFn }; // the declared type lacks `t`
      notify(t("errors.loadUsers"), "USERS_LOAD_ERROR");
    },
  },
});
```

`notify` passes its arguments to the registered function unchanged. `t` is the store's current translator — the one given to the constructor, to `<PalistorProvider>`, to `store.setTranslator` or to `useTranslator`. It is a stable reference that follows a later `setTranslator`; without a translator it returns the key. Every `onError` gets both: a group's, a list's, a paginated list's, a row field's, and the template resolve of `useForm(entity, template)`.

The exported type `ResolveErrorContext` still declares only `{ notify }`. Where the resolve is typed — inside `defineList`, a typed template, an object typed `Resolve<T>` — cast as above; the cast works everywhere. Only in a plain config object can the parameter be annotated instead: `onError: (error: unknown, { notify, t }: { notify: NotifyFn; t: TranslateFn }) => notify(t("errors.loadProfile"))`.

---

## Store context

> 🔗 **Source:** [modules/lists-demo/ListsDemo.tsx](./app-demo/src/modules/lists-demo/ListsDemo.tsx) (`useStoreContext`), [StoreContextSection.tsx](./app-demo/src/modules/lists-demo/StoreContextSection.tsx) · **Live result:** [Demo → Lists & entities](https://projectint.github.io/palistor/#lists)

Non-reactive data (account id, tenant, tokens…) available as `store.context` to the callbacks that receive the store: resolvers, `onSubmit`, `onEnter` / `onReady` (a filter's `$toParams` gets it as its second argument). It is not part of the form — it does not appear in `getValues()`, submit payloads or persisted state.

```tsx
import { useStoreContext } from "palistor";

function Layout({ children }: { children: React.ReactNode }) {
  const accountId = useAccountId();
  useStoreContext(store, { accountId }); // merges into store.context
  return <>{children}</>;
}
```

```typescript
resolve: {
  resolver: async (_values: unknown, store: ProxyStore<any>) =>
    api.fetchUsers(store.context.accountId as string), // the read makes accountId a dependency
  contextDeps: ["accountId"], // every run waits until context.accountId != null
},
```

A resolver re-runs when a context key it read through its `store` argument changes with `setContext` (`useStoreContext`, `usePalistor`, the provider). `contextDeps` only gates the run. `setContext` merges shallowly and re-renders nothing; mutating the context object in place re-runs nothing. You can also pass an initial context to the constructor: `new Palistor({ config, context: { accountId } })`. `store.context` is typed `Record<string, unknown>`: cast what you read.

`useStoreContext` sets the context in an effect, after mount. For the first render — the server one included — the context has to be in the constructor: pass it there, or put the shared keys on `<PalistorProvider context={{ accountId }}>`. `usePalistor` merges the provider's context into the constructor of every store below (the store's own `context` option wins per key) and pushes later changes into the store; `usePalistorContext()` reads the same values in a component (see [SSR & Next.js](#ssr--nextjs)). `useStoreContext` stays as it is and applies after mount.

---

## SSR & Next.js

> 🔗 **Source:** [app/ssr/](./app-demo/src/app/ssr) — five routes, each a Server Component (`page.cube.tsx`) that reads its data and hands it to a client view with `usePalistor`; the provider and the page frame are in [`shared/`](./app-demo/src/app/ssr/shared). e2e: [e2e/ssr*.spec.ts](./app-demo/e2e) · **Live result:** the `/ssr` routes of the playground (they reach the live demo with 0.1 — see [Demo](#demo); locally under `/palistor/ssr/`)
>
> | Route | What it shows |
> |---|---|
> | `/ssr` | A list with server data and a filter (no request after hydration), a list without server data (its skeleton is in the HTML), a `suspense: true` group (its fallback is in the HTML) |
> | `/ssr/form` | A group with `resolve` prefilled through `initialData` (`dirty: false`, `reset()` returns to the server's values), re-runs on declared `deps` and on a list's `reload()`, resolver errors translated by `onError` with the store's `t` and sent to the provider's `notifier`, a `usePersist` draft laid over the server's data after mount |
> | `/ssr/catalog` | The first page of a paginated list as `{ items, total }` (page 2 is one request, page 1 comes back from the cache), a "load more" feed ended by `nextCursor: null`, the `isInitialLoading` skeleton of a paginated list without server data, lists nested in rows |
> | `/ssr/flow` | A flow step with server data (`onEnter` and `onReady` once in the browser, no request), a next step that loads once and stays cached, a flow without data whose active step's loading state is in the HTML |
> | `/ssr/runtime` | `server: true` and `store.start()`, an eager resolve started by `usePalistor` after the first commit, one store per component instance, a nested `<PalistorProvider context>` driving `contextDeps` |

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
      resolver: async (values, store) =>
        api.getCustomers(store.context.accountId as string, values.search),
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

const notifyError = (message: string, code?: string) =>
  addToast({ title: message, description: code, color: "danger" });

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

A module-level store without request data keeps working under SSR: server mode applies to it on the server. In the browser, though, it is not held — it starts when its module loads, before hydration — so an eager resolve or the active step's resolve may land before hydration, and then even `loading` differs from the server render. For markup that hydrates exactly, use `usePalistor`.

### One store for the whole app

A store the whole app shares — the signed-in account, a cart, layout state that the header and every page read — is created the same way: once, in a Client Component the root layout renders. Each request renders its own provider, so the server builds one store per request. In the browser Next.js keeps a layout mounted while the pages inside it change, so the store, and what the user typed into it, lives through client navigations, like a module-level store does.

Components still get their nodes as props, as in [One component per node](#one-component-per-node). Only one thing is new. A Server Component cannot hand a node down: the layout gets the page as opaque `children`, and a node is not serializable. So the store crosses that boundary through a React context of your own, and only there: the first Client Component below a Server Component — the header, a page's view — reads the context once, and from it the nodes go down as props.

```tsx
// app/AppStore.tsx
"use client";
import { createContext, useContext } from "react";
import { usePalistor, type Palistor } from "palistor";

export interface Account { id: string; name: string }

const appConfig = {
  account: { id: { value: "" }, name: { value: "Guest" } },
  sidebarOpen: { value: true },
};

type AppStore = Palistor<typeof appConfig>;
const AppStoreContext = createContext<AppStore | null>(null);

export function AppStoreProvider({ account, children }: { account: Account | null; children: React.ReactNode }) {
  const store = usePalistor(() => ({                  // the only usePalistor call for this store
    config: appConfig,
    initialData: account ? { account } : undefined,   // the request's data, from the layout
  }));
  return <AppStoreContext.Provider value={store}>{children}</AppStoreContext.Provider>;
}

/** For the entry of a client subtree: the component a Server Component renders. */
export function useAppStore(): AppStore {
  const store = useContext(AppStoreContext);
  if (!store) throw new Error("useAppStore: <AppStoreProvider> is missing above this component");
  return store;
}
```

```tsx
// app/Header.tsx — the entry of a client subtree: its one context read
"use client";
import { useForm, type FieldProxyNode } from "palistor";
import { useAppStore } from "./AppStore";

export function Header() {
  const form = useForm(useAppStore());   // hands nodes down and reads no state: it never re-renders
  return <header><AccountBadge name={form.account.name} /></header>;
}

// Knows neither the store nor the context: it is on the field its parent gave it.
function AccountBadge({ name }: { name: FieldProxyNode<string> }) {
  return <span>{useForm(name).value}</span>;
}
```

```tsx
// app/settings/SettingsView.tsx — the entry of the page; app/settings/page.tsx renders <SettingsView />
"use client";
import { useForm, type FieldProxyNode, type PalistorProxy } from "palistor";
import { useAppStore, type Account } from "../AppStore";

export function SettingsView() {
  const form = useForm(useAppStore());
  return <AccountSection account={form.account} />;
}

function AccountSection({ account }: { account: PalistorProxy<Account> }) {
  const a = useForm(account);
  return <TextField field={a.name} />;   // level after level, as deep as the config goes
}

function TextField({ field }: { field: FieldProxyNode<string> }) {
  const f = useForm(field);
  return <input value={f.value} onChange={(e) => f.onValueChange(e.target.value)} />;
}
```

```tsx
// app/layout.tsx — Server Component
import { getAccount } from "@/data/account";
import { AppStoreProvider } from "./AppStore";
import { Header } from "./Header";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const account = await getAccount();   // on the server; null for a signed-out visitor
  return (
    <html lang="en">
      <body>
        {/* key: signing in or out is another provider instance: a new store with the new account */}
        <AppStoreProvider key={account?.id ?? "guest"} account={account}>
          <Header />
          {children}
        </AppStoreProvider>
      </body>
    </html>
  );
}
```

Typing in the settings field re-renders that field and the badge in the header. The provider, `Header`, `SettingsView` and `AccountSection` do not re-render.

What follows from the rules above:

- **`usePalistor` is called once, in the provider.** A second call with the same config builds a second store: the server HTML still looks right, but an edit in one component never reaches another.
- **The context is read once per client subtree, by its entry.** `Header` and `SettingsView` are rendered by Server Components, so no prop can reach them; every component below gets its node as a prop and calls `useForm` on it. A component that takes the whole store from the context instead still works, but it is tied to this app's store and to one path in it: its parent no longer decides which node it shows, and it cannot be reused on another one.
- **`initialData` is read once.** A layout that can re-render with another account without a page load (sign-in, sign-out, `router.refresh()`) needs the `key` shown above. A full page load builds a new store anyway.
- **Put the provider below `<PalistorProvider>`** when the app has one: the app store gets the translator, the notifier and the shared context in its constructor, like every other store.
- **Nothing outside React can import this store.** A handler or helper takes it as an argument from the component that has it; a resolver of another store takes the value it needs as a `context` key.

Which store to create:

| | Module-level `new Palistor()` | `usePalistor` in a layout provider |
|---|---|---|
| Request data in the first HTML | No: `initialData` is constructor-only, and the module is shared by every request | Yes |
| Translator and context in the first HTML | Only what is available without a hook | Yes, from `<PalistorProvider>` |
| Starts in the browser | When its module loads, before hydration | After the provider's first commit |
| Reachable outside React | Yes, by import | No: pass it as an argument |
| How a component gets its node | A prop from its parent; the root imports the store | A prop from its parent; the entry of each client subtree reads the context |

### Server mode

A store created where `window` is undefined is in server mode: it starts nothing by itself. No eager resolver, no lazy resolver on read, no page fetch, no flow step entry (`onEnter` / `onReady` are not called). Whatever would have started reads `loading: true`, and the store the browser creates runs each resolver once. `useStoreContext`, `useTranslator`, `useNotifier` and `usePersist` work in effects, which the server does not run, so on the server they do nothing.

`usePalistor` keeps the same rule for a render in the browser. It builds the store held, so nothing starts during a render, and an effect calls `store.start()` once the component has committed. The first client render therefore reads what the server's render read — `loading: true`, a list's `resolveStatus: "idle"` — and the two are equal by construction. A render React throws away (a transition interrupted because another store changed under it, a component that suspends before its first commit) leaves a store that has requested nothing: only the committed instance's store starts. With `server: true` the hook is in manual mode: it never starts the store, and `store.start()` is yours to call. A store made with `new Palistor()` is not held: in the browser its constructor starts it.

One consequence outside Next.js: a script or a test without a DOM (Vitest's `node` environment, for example) is in server mode too. Start the store explicitly, or turn the mode off:

```typescript
const store = new Palistor({ config });                 // no `window` → server mode
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
- **A node that waits for its `contextDeps` does not throw**: it is not about to run, so it renders its defaults, with no fallback.
- **In the browser the first render shows the defaults.** A `usePalistor` store is held until its component commits, but it is not in server mode: it has no run to throw and does not throw the server's error either, so a `suspense: true` node without data renders its default values with `loading: true`. Once the store starts, a component that reads the node's own `loading` along with its fields re-renders and suspends: the boundary's fallback, then the data. A `suspense: true` list is held the same way: an empty first render without an error, then the fallback, then the rows.
- **Manual mode (`server: true`) is server mode, in the browser too**: call `store.start()` before anything reads a `suspense: true` node without data. Until then such a read throws the server's error, and in the browser React hands it to an error boundary, not to `<Suspense>`.
- **The component that calls `usePalistor` may read the node itself.** It suspends after its commit, so React keeps its state: one store, one request. The boundary then goes above that component.
- **A component that reads only the node's children is not re-rendered by the start**: it keeps the defaults until the data lands and never shows the fallback on a client mount. Below the boundary read the node's `loading` as well, or branch on it (`if (car.loading) return <Skeleton />`), or give the node `initialData`. A list re-renders its readers when the run starts, so a reader of a `suspense: true` list always reaches the fallback.
- **A component that suspends before its first commit for another reason keeps nothing**, the store included: the options function runs again and another store is built. The dropped stores request nothing; only the store of the render that commits starts.
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
    // a paginated list: its first page as the resolver returns it —
    // { items, total?, nextCursor?, hasMore? } or a bare array
    invoices: { items: firstPage, total: 240 },
  },
});
```

A node with `resolve` that got data is in the state its resolver would have left by returning the same data: the values, the dirty baseline (`dirty: false`; `reset()` returns to this data and requests nothing, for nested lists too), the list membership, `resolveStatus: "resolved"`, `loading: false`. Its resolver is called neither on the server nor after hydration. The one exception is nested lists: `initialData` (like a persisted draft) fills the lists nested in its rows, while the rows a list resolver returns do not — a nested array inside a resolver's row is not a nested list's membership. A nested list is filled by its own resolver, by `setItems` / `add`, or by `initialData`. A flow step that got data fires `onEnter` and then `onReady` at once on its first entry, without a request; a `reset()` that covers the flow sends it back to its first step, and step resolves run again on entry, data or not. Both renders need the same data; in Next.js they get it with the same props.

`initialData` is not `initialValues`: those only override the config defaults, and a node with `resolve` still resolves after them. The data is applied over `initialValues`. A group's own `resolve` counts as answered when the data carries a value for at least one leaf below it, outside lists: `{ customers: [...] }`, a list nested in a subgroup or an empty `{ car: {} }` do not answer the `resolve` of a group or of the root. A leaf with a computed `value` ignores its data.

Limits:

- **Declare `deps`.** The resolver has not run in the browser, so the reads auto-tracking would have found are unknown until its first real run. Until then the node re-runs only on its declared `resolve.deps`, on a change of a `contextDeps` key, on a change of the list's filter or server sort and on the list's `reload()`. A group has no `reload()`: it is re-run only by its declared `deps` and `contextDeps`. If a list must reload when a field changes, name that field in `deps`. A paginated list is keyed on `deps`, the filter and the server sort (it ignores `contextDeps`; name a context key in `deps` as `"$context.accountId"`); its next page is requested as usual. The list resolve types do not declare `contextDeps`: on a plain list it works at runtime, but needs a cast.
- **The data must be what the store would request right now**: for the initial filter values, the `$default` of a server sort, the first page (`pagination.initialPage`) and the same context. The context has to be in the constructor or the provider: a `contextDeps` key that arrives later through `useStoreContext` counts as a change and re-runs the resolver right after hydration. A paginated list files the rows under its current query key.
- **The data is embedded in the HTML.** Props of a Client Component are serialized into the page — pass only what the user may see.
- **Every row needs an `id`.** A row without one gets a temporary id that differs between the server and the browser (dev warning: `initialData: a row of list "…" has no id`).
- **Keys that are not in the config are ignored** (dev warning: `initialData: "…" is not in the config; ignored`). Keys inside rows are not checked.

### With `usePersist`

`usePersist` hydrates in an effect, after mount, so the saved draft is laid over the server data: the first render matches the server HTML, then the draft appears and the form is dirty against the server data. This order is intended.

---

## TypeScript

Values, nodes, entities and even `fieldMapping` renames are inferred statically from the config. Loosely typed: `store.context` (`Record<string, unknown>`), a list resolver's `values`, the two-argument `useForm(entity, template)` (returns `any`), the filter block, and `ResolveErrorContext` (no `t`). `useForm(node)` does not compile for a node of a store whose `fieldMapping` renames one of that node's props (any rename for a field; a prop groups also have, such as `isRequired` or `isDisabled`, for a group), although it runs: call `useForm(store)` in that component and drill down. The pagination members of a list are optional in its type (`list.setPage!(2)`), and list rows are opaque `PalistorRef`s until they pass through `useForm`.

**Annotate config callbacks.** The parameters of config functions are not inferred: in a `strict` project `(v) => v.paymentType === "card"` is error TS7006. Annotate them with your values interface, as the examples above do: `isVisible: (v: PaymentValues) => …`.

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

`PalistorProxy<T>` maps a plain values interface onto the node tree (the type is named `PalistorProxy` because the value `Palistor` is the store class):

```tsx
import { useForm, type PalistorProxy } from "palistor";

interface UserData { name: string; email: string; address: { city: string } }

function UserForm({ user }: { user: PalistorProxy<UserData> }) {
  const u = useForm(user);
  return (
    <>
      <input value={u.name.value} onChange={(e) => (u.name.value = e.target.value)} />
      <TextField field={u.address.city} />
    </>
  );
}
```

A component of one field takes `FieldProxyNode<T>`, and `useForm` gives the same node back:

```tsx
import { useForm, type FieldProxyNode } from "palistor";

function TextField({ field }: { field: FieldProxyNode<string> }) {
  const f = useForm(field);
  return <input value={f.value} onChange={(e) => f.onValueChange(e.target.value)} />;
}
```

### Typed entity references

```tsx
import { useForm, type PalistorRef, type PalistorList, type InferEntity } from "palistor";

interface User { id: string; name: string }

function UserRow({ user }: { user: PalistorRef<User> }) {
  const u = useForm(user);                         // typed: PalistorEntityProxy<User>
  const edit = useForm(user, (s) => s.editUserForm); // through a template: any
  return <span>{u.name.value}</span>;
}

type UserEntity = InferEntity<PalistorRef<User>>; // → User
type UsersList  = PalistorList<User>;             // typed list node
```

### Type reference

| Type | Purpose |
|-----|-----|
| `ExtractValues<TConfig>` | Values type inferred from a config |
| `ConfigProxy<TConfig>` | Full node tree type — what `useForm(store)` returns |
| `Palistor<TConfig, TMapping?>` | The store instance type (with `start()`) — for a store prop |
| `ProxyStore<TConfig>` | The store interface a resolver receives as `store` (`ProxyStore<any>` to annotate it) |
| `PalistorProxy<T>` | Node tree built from a plain values interface — for child-component props |
| `PalistorRef<TEntity>` | Opaque entity reference — for single-item props |
| `PalistorEntityProxy<T>` | One entity's node, `id` as a string — what `useForm(ref)` returns |
| `PalistorList<TEntity>` / `ListProxyNode<TItem>` | Typed list node |
| `InferEntity<T>` | Extract the entity type from a `PalistorRef` |
| `FieldProxyNode<TValue>` / `GroupProxyNode` | A field's / a group's node. `FieldProxyNode<T>` types the prop of a one-field component: `useForm(field)` returns the same type |
| `ConfigNode<TValue, TValues>` / `FormConfig<TValues>` | A config node; a config object typed over a values interface |
| `FieldMapping` / `defineFieldMapping` | Prop renaming map (preserves literals) |
| `FlowProxyNode<S>` / `FlowStepProxy<C>` / `FlowStepsProxy<S>` / `StepStatus` | Flow node types |
| `FlowError` / `FlowValues` / `DefineFlowOptions` | Flow errors, values, `defineFlow` options |
| `MaybeComputed<TResult, TValues>` | Constant or `(values) => T` — `isVisible`, `isRequired`, `value` |
| `MaybeTranslatable<TResult, TValues>` | Constant or `(t, values) => string` — `label`, `placeholder` |
| `DeepPartialValues<T>` | Deep-partial values: `initialValues`, `setter` patches, `setValues` |
| `TranslateFn` | Compatible with next-intl `t`, i18next `t`, any `(...args) => string` |
| `TemplateConfig<TEntity>` / `ListResolver<TEntity>` / `ListResolveContext` | Typed list template / resolver / the resolver's third argument (`filter`, `sort`, `page`, `queryKey`; `sort` is required) |
| `FilterBlock<TEntity>` / `FilterFieldConfig<TEntity>` / `FilterProxyNode` | A list's `filter` block (with `$apply`), one filter field (with `apply`), the `list.filter` controls (with `apply()`, `revert()`, `isDraft`, `applied`) — the prop type of a filter panel |
| `SortBlock<TEntity>` / `SortFieldConfig<TEntity>` / `SortProxyNode<K>` | A list's `sort` block, one sort field (`true`, `{ by }`, `{ compare }`, `{ param }`), the `list.sort` controls — the prop type of a sort header |
| `SortKey<TEntity>` / `SortDirection` / `SortRequest` | The keys a list of `TEntity` sorts by (its leaves, nested ones as `"address.city"`), `"asc" \| "desc"`, the resolver's `ctx.sort` |
| `PaginationConfig` / `PageMode` / `PageRequest` / `PagedResult<T>` | The `pagination` block, its mode, the `ctx.page` request, what a paginated resolver returns |
| `PersistDriver` / `PersistOptions` / `PersistManager` | Persistence contracts |
| `Resolve<T>` / `ResolveStatus` / `NotifyFn` / `ResolveErrorContext` | Resolver contracts. `Resolve<T>` declares `onError` as required. `ResolveErrorContext` is declared as `{ notify }` although `onError` also gets `t`: in a plain config object annotate the parameter as `{ notify, t }: { notify: NotifyFn; t: TranslateFn }`; where the resolve is typed, cast `ctx as ResolveErrorContext & { t: TranslateFn }` |
| `InitialData<TConfig>` / `PalistorOptions<TConfig, TMapping?>` / `PalistorProviderProps` | SSR contracts: the `initialData` shape for a config, constructor options, provider props |

---

## Migrating to 0.1

0.1 replaces the engine and keeps the language: the same config, the same exports, the same type names, the same subpath imports. Code written for 0.0.x is expected to compile and run unchanged, except for the points below. Until 0.1 is released as `latest`, install it with `npm install palistor@cube`; a `^0.0.x` range never picks a prerelease up by itself.

**May need a change**

| What changed | What to do |
|---|---|
| **Reserved child names.** A group child named `submitting`, `revalidate`, `values`, `submit`, `setValues` or `onValueChange` throws in the constructor, naming the path; a list template child named `loading`, `submitting`, `submit`, `values` or `dirty` throws when a row is first read. 0.0.x accepted such a child and never let you reach it. (Config keys such as `label` or `value` were never children and still are not.) | Rename the child. |
| **Server mode.** Where `window` is undefined (Node, a server render) a store starts nothing by itself: no resolver, no page fetch, no flow step entry. | A script or a test without a DOM calls `store.start()` or passes `server: false`. Tests under jsdom are not affected. See [Server mode](#server-mode). |
| **`suspense: true` on the server.** A group or a list with `suspense: true` and no data throws a bail-out error during a server render. (In 0.0.x a lazy one rendered its defaults and an eager one suspended on its server-side run.) | Put a `<Suspense>` boundary above the reader, or give the node `initialData`. See [`suspense: true` on the server](#suspense-true-on-the-server). |
| **`nextCursor: null` ends a feed** in `cursor` and `infinite` modes, even with a `total`, `hasMore: true` or a full page. | A feed that continues by offset omits `nextCursor` instead of sending `null`. |
| **List `dirty` includes nested lists.** An `add` / `remove` / `setItems` inside a list nested in a row makes the row's list and the form dirty. | Code that shows "unsaved changes" from `form.dirty` now sees these edits too. |
| **A full `store.reset()` keeps row data.** Nested lists and row fields whose resolve had completed return to the loaded data and are not requested again. | Call the nested list's `reload()` to fetch it again. |
| **`PersistManager` is a type only.** `palistor/store/persist` exported it as a class in 0.0.x; `new PersistManager(…)` and `instanceof PersistManager` no longer compile. | Use `store.persist`: the same methods. |
| **The store's internals are gone.** The TypeScript instance type still lists members of the 0.0.x class (`nodes`, `services`, `groupDepsMap`, `recompute()`, …); none of them exists on a 0.1 store. | Use only the API documented above. |
| **Four more reserved filter field names.** A filter field named `apply`, `revert`, `isDraft` or `applied` throws when the store is created: they are members of `list.filter` now. (0.0.x and the 0.1 prereleases up to `0.1.1-cube.2` accepted them.) | Rename the field. |
| **`ctx.sort` in the list resolver context.** Every list resolver gets `ctx.sort` — `{ by: [], key: "" }` without a server sort — and the package's `ListResolveContext` declares it required. A resolver does not change; code that builds the context by hand, such as a test that calls a resolver directly, no longer compiles without it. | Add `sort: { by: [], key: "" }` to the hand-built context. |

**No action needed**

- `loading` is `true` from the first read of a lazy resolve (before: from the start of the run, a microtask later), and reading `loading` of a group, a list or a flow — or `isInitialLoading` of a paginated list — wakes a lazy resolve. A component that renders a spinner on `loading` shows it in its first render. `resolveStatus` still stays `"idle"` until the run starts.
- `onError(error, ctx)` gets the store's translator as `ctx.t`, next to `ctx.notify`.
- `useForm(field)` is typed: a component that gets one field as a prop types it `FieldProxyNode<T>` instead of `any` (the call always worked). See [One component per node](#one-component-per-node).
- A paginated list no longer warns `pagination invariant … has no cached page` when its query key changes.
- New: `usePalistor`, `<PalistorProvider>`, `usePalistorContext`, the constructor options `translator`, `notifier`, `initialData` and `server`, `store.start()` — see [SSR & Next.js](#ssr--nextjs). And five [agent skills](#agent-skills) inside the package.
- New: list sorting — the `sort` block, `list.sort`, `ctx.sort` (see [Sorting](#sorting)) — and the filter's "Apply" mode — `$apply` / `apply`, `filter.apply()`, `revert()`, `isDraft`, `applied` (see ["Apply" mode](#apply-mode)). A list without a `sort` block and a filter without `$apply` behave as before. The 0.0.x line has neither: its `defineList` drops a `sort` block, and its filter throws on `$apply` as an unknown option.
- From an earlier 0.1 prerelease (`0.1.0-cube.1`): a `usePalistor` store starts after the first commit, not in its constructor; in the first render an eager list reads `resolveStatus: "idle"` (was `"pending"`), and an eager `suspense: true` group shows its defaults, not the fallback.

**Fixed in 0.1**

- A field a resolver reads re-runs it on every change; in 0.0.x the resolver went silent after 10 changes (group and field resolvers, paginated lists, server filter fields).
- A group's `loading` stays `true` while its resolve runs, also when the group has a computed key (`label`, `isVisible`, …).
- A successful submit clears the persisted draft for good (in 0.0.x the next notification wrote it back); a storage quota error of the built-in drivers reaches `onError`.
- `store.proxy.values` has no filter key.

---

## License

[MIT](./LICENSE) © Yuri Palienko
