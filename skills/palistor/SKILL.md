---
name: palistor
description: >
  Use when a React project depends on `palistor` and the task is to build or
  change a form, an editable screen or other config-driven UI state: declare a
  field or group config, create a store with `new Palistor({ config })`, connect
  components with `useForm`, add validation, required and visibility rules,
  computed values, formatters, setters, submit and reset, async `resolve`,
  persistence, i18n or error notifications. Also use it when such a form
  misbehaves: errors never appear, a hidden field blocks submit, a component
  does not re-render. Read this first. For collections of items use
  palistor-lists, for step-by-step wizards use palistor-flows, for UI-kit prop
  renaming and input adapters use palistor-field-mapping, for rendering on the
  server in Next.js use palistor-ssr.
metadata:
  purpose: "Build forms with the Palistor reactive form state manager. Use when:
    creating form configs, writing React components with useForm, adding
    validation/formatters/setters, working with lists/entities, building
    multi-step wizards/flows (defineFlow/defineStep), configuring
    resolve/persist/submit pipelines, remapping field prop names to UI-library
    conventions (fieldMapping — Ant/MUI/Chakra), debugging form state."
  type: core
  library: palistor
  library_version: '0.1.0-cube.1'
sources:
  - 'ProjectINT/palistor:index.ts'
  - 'ProjectINT/palistor:cube/index.ts'
  - 'ProjectINT/palistor:cube/palistor.ts'
  - 'ProjectINT/palistor:cube/types.ts'
  - 'ProjectINT/palistor:cube/core/cube.ts'
  - 'ProjectINT/palistor:cube/core/config.ts'
  - 'ProjectINT/palistor:cube/core/node.ts'
  - 'ProjectINT/palistor:cube/core/resolve.ts'
  - 'ProjectINT/palistor:cube/core/persist.ts'
  - 'ProjectINT/palistor:cube/core/hub.ts'
  - 'ProjectINT/palistor:cube/react/*.ts'
  - 'ProjectINT/palistor:react/useForm.ts'
  - 'ProjectINT/palistor:store/store/types.ts'
  - 'ProjectINT/palistor:store/store/palistor.ts'
  - 'ProjectINT/palistor:store/resolvePipeline/types.ts'
  - 'ProjectINT/palistor:store/persist/types.ts'
---

# Palistor: config-driven forms

All behavior lives in a config object, state lives in a store outside React, components only render:
**config → store → `useForm` → spread**. Start from the config, never from component state.

## Setup

One module holds the config, the store and the form. Create the store at module level — one store per
form — and never call `new Palistor` in a component body. The exception is state that holds data of
the current request in an app rendered on the server (Next.js App Router), whether one screen's or a
store the whole app shares: there the store is created per component instance with `usePalistor`;
read `palistor-ssr` before writing it.

```tsx
// orderForm.tsx
import type { FormEvent } from "react";
import { Palistor, useForm } from "palistor";
import type { FieldProxyNode } from "palistor";

type Delivery = "pickup" | "courier";
type OrderValues = { email: string; delivery: Delivery; address: string };

const byCourier = (values: OrderValues) => values.delivery === "courier";

// 1. The config holds every rule of the form.
export const orderStore = new Palistor({
  config: {
    email: {
      value: "", // a node with `value` is a field (leaf)
      label: "Email",
      isRequired: true,
      formatter: (raw: unknown) => String(raw).trim().toLowerCase(),
      validate: (value: string) => (value.includes("@") ? undefined : "Enter a valid email"),
    },
    delivery: { value: "pickup" as Delivery },
    address: { value: "", label: "Address", isVisible: byCourier, isRequired: byCourier },
    onSubmit: async (values: OrderValues) => api.createOrder(values),
  },
});

// 2. One thin adapter per input kind; a field is spread into it.
function TextField(props: FieldProxyNode<string>) {
  const { isVisible, label, value, onValueChange, isRequired, isDisabled, isInvalid, errorMessage } = props;
  if (!isVisible) return null; // the adapter consumes isVisible; nothing leaks to the DOM
  return (
    <label>
      {label}
      {isRequired ? " *" : null}
      <input value={value} disabled={isDisabled} onChange={(e) => onValueChange(e.target.value)} />
      {isInvalid ? <em role="alert">{errorMessage}</em> : null}
    </label>
  );
}

// 3. The component reads the store through useForm and keeps no state of its own.
export function OrderForm() {
  const form = useForm(orderStore); // tracking proxy: re-renders only for fields read here
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    // Invalid input resolves as { success: false, errors }; the promise rejects only if onSubmit throws.
    form.submit().catch(() => toast.error("Could not place the order"));
  };
  return (
    <form onSubmit={onSubmit}>
      <TextField {...form.email} />
      <select value={form.delivery.value} onChange={(e) => form.delivery.onValueChange(e.target.value as Delivery)}>
        <option value="pickup">Pickup</option>
        <option value="courier">Courier</option>
      </select>
      <TextField {...form.address} />
      <button type="submit" disabled={form.submitting}>Order</button>
    </form>
  );
}
```

Result to check: typing in a field updates it, `address` appears only for `courier`, and submitting an
empty form shows the errors without calling `onSubmit`.

- Annotate every callback parameter. The config is inferred from the literal, so an un-annotated
  parameter is an implicit-`any` error (TS7006) in a `strict` project.
- A field spread carries `value`, `onValueChange`, `label`, `placeholder`, `description`, `isRequired`,
  `isReadOnly`, `isDisabled`, `isVisible`, `isInvalid`, `errorMessage`: one adapter displays and edits.
- A field typed as a union accepts only that union on write: cast what a `<select>` yields
  (`as Delivery`).
- If the inputs come from a UI kit (MUI, Ant Design, Chakra, HeroUI) or expect other prop names, write
  the adapter with the `palistor-field-mapping` skill instead of the native one above.

## Core Patterns

### Put each rule in its config key

| Need | Config key | Notes |
| --- | --- | --- |
| Initial or derived value | `value` | A function `(values) => T` makes the field computed |
| Validation | `validate(value, values, t)` | Return a message; any falsy result means valid |
| Required, hidden, disabled, read-only | `isRequired`, `isVisible`, `isDisabled`, `isReadOnly` | `boolean` or `(values) => boolean` |
| Normalize input | `formatter(raw, formValues)` | Runs on every write, before the value is stored |
| Change sibling fields on write | `setter(value, values, previous)` | Return a patch; it is applied to the field's own group |
| Async reaction to a change | `onChange({ fieldKey, newValue, previousValue, allValues })` | Fire-and-forget; may return a patch |
| Texts | `label`, `placeholder`, `description` | `string` or `(t, formValues) => string` |
| Submit | `onSubmit`, `beforeSubmit`, `afterSubmit` | On the root, a group or a single field |
| Load data | `resolve` on a group | See [async resolve](references/async-resolve.md) |

Functions re-run automatically when a value they read changes. There is nothing to declare: the
`dependencies` key is accepted and ignored.

Scope of the `values` argument — the rule that is not visible from the types:

- `value`, `validate`, `setter` and the four flags receive the values of the node's **parent group**
  (its siblings). For a top-level field that is the whole form.
- `formatter`, `label` / `placeholder` / `description` and `onChange`'s `allValues` receive the
  **whole form**.

When you need a key that is not in the table, or the exact arguments of a callback, read
[config options](references/config-options.md).

### Group fields

A node without `value` is a group: a section with its own flags, submit, reset and values.

```ts
import { Palistor } from "palistor";

interface CompanyValues {
  name: string;
  vatId: string;
}

export const profileStore = new Palistor({
  config: {
    hasCompany: { value: false },
    company: {
      // A group's own flags see its parent's values: here the whole form.
      isVisible: (values: { hasCompany: boolean }) => values.hasCompany,
      // Fields inside see only this group: `values.hasCompany` is undefined in here.
      name: { value: "", label: "Company" },
      vatId: { value: "", label: "VAT", isRequired: (values: CompanyValues) => values.name !== "" },
      onSubmit: async (companyValues: CompanyValues) => api.saveCompany(companyValues),
    },
  },
});
```

`form.company.values` is a live object of the group's values, `form.company.submit()` validates and
submits only that subtree, `form.company.reset()` restores it.

### Validate and submit

- Errors stay hidden until the first `submit()` of the form (or of the enclosing group). After it,
  `isInvalid` and `errorMessage` update on every write. `reset()` hides them again.
- `isInvalid` is `true` or `undefined`, never `false`: test truthiness, coerce with `!!` for a strict
  boolean prop.
- An empty required field reports the literal message `"required"`. To word or translate it, return
  the message from `validate`: `validate: (value: string, _values: unknown, t: TranslateFn) => (value ? undefined : t("errors.required"))`.
- `submit()` runs: mark submitting → show errors → `beforeSubmit` → validate → `onSubmit` →
  `afterSubmit`. It resolves to `{ success: true, result }` or `{ success: false, errors }` with
  `errors: Array<{ path, message }>`; on validation failure `onSubmit` is not called.
- `submit()` **rejects** when `onSubmit` throws. Catch it where you call it, or handle the failure
  inside `onSubmit`.
- A second `submit()` while one is running starts another `onSubmit`: bind the button's `disabled` to
  `submitting`.

```ts
import { Palistor } from "palistor";

const store = new Palistor({
  config: {
    email: { value: "", isRequired: true },
    onSubmit: async (values: { email: string }) => api.subscribe(values),
  },
});

export async function subscribe() {
  try {
    const result = await store.submit(); // the same call as form.submit() on the root
    if (!result.success) return result.errors; // [{ path: "email", message: "required" }]
    return result.result; // what onSubmit returned
  } catch (error) {
    toast.error("Could not subscribe"); // onSubmit threw: not form state, report it your way
  }
}
```

### Show a field conditionally

Hiding a field does not switch its validation off. Repeat the predicate in `isRequired` (and guard
`validate` with it), and keep the fields in the same group as the value they depend on, because that
is the only `values` they see.

```ts
import { Palistor } from "palistor";

interface PaymentValues {
  method: "card" | "bank";
  cardNumber: string;
  iban: string;
}

const byCard = (values: PaymentValues) => values.method === "card";
const byBank = (values: PaymentValues) => values.method === "bank";

export const paymentStore = new Palistor({
  config: {
    method: { value: "card" as PaymentValues["method"] },
    cardNumber: {
      value: "",
      isVisible: byCard,
      isRequired: byCard,
      validate: (value: string, values: PaymentValues) =>
        byCard(values) && value.length < 16 ? "Enter 16 digits" : undefined,
    },
    iban: { value: "", isVisible: byBank, isRequired: byBank },
  },
});
```

Use a hidden **group** with unconditionally required fields only when that group is submitted on its
own (`form.company.submit()`). For a branching multi-step screen use `palistor-flows`: a hidden step
is exempt from the final validation.

### Compute and cascade

```ts
import { Palistor } from "palistor";

export const invoiceStore = new Palistor({
  config: {
    price: { value: 0, formatter: (raw: unknown) => Number(raw) || 0 }, // inputs yield strings: coerce here
    quantity: { value: 1, formatter: (raw: unknown) => Number(raw) || 0 },
    total: { value: (values: { price: number; quantity: number }) => values.price * values.quantity },
    country: { value: "", setter: () => ({ city: "" }) }, // reset the dependent sibling on change
    city: { value: "" },
  },
});
```

Computed values appear in `getValues()` and in the submit payload like any other field; remove one in
`beforeSubmit` when the server must not receive it.

### Split rendering into child components

Mirror the config tree with the component tree. A component gets its node as a prop, calls `useForm`
on it and hands its children their nodes: a group to a section, a single field to an input. The rule
is the same on every level, so the chain goes as deep as the config does.

```tsx
import { Palistor, useForm } from "palistor";
import type { FieldProxyNode, PalistorProxy } from "palistor";

interface Address { city: string; zip: string }
interface Company { name: string; address: Address }

const profileStore = new Palistor({
  config: { company: { name: { value: "" }, address: { city: { value: "" }, zip: { value: "" } } } },
});

// The root: the only component that sees the store.
export function ProfileForm() {
  const form = useForm(profileStore);
  return <CompanySection company={form.company} />;
}

function CompanySection({ company }: { company: PalistorProxy<Company> }) {
  const c = useForm(company);
  if (!c.isVisible) return null;
  return (
    <fieldset>
      <Field field={c.name} />
      <AddressSection address={c.address} />
    </fieldset>
  );
}

function AddressSection({ address }: { address: PalistorProxy<Address> }) {
  const a = useForm(address);
  return <><Field field={a.city} /><Field field={a.zip} /></>;
}

// One component for any string field on any level: an edit re-renders this component alone.
function Field({ field }: { field: FieldProxyNode<string> }) {
  return <TextField {...useForm(field)} />;
}
```

- The parent picks the node. A child imports neither the store nor the config: it is typed by the shape
  of its node, and the node in the prop carries its store.
- A component that only hands nodes down reads no state and does not re-render when fields below change.
  `<TextField {...c.name} />` straight in a section reads the field there: the section re-renders with
  every edit of it. Give the field a component of its own, as above, when that matters.
- Re-rendering is per node: a component re-renders when any state of a node it read changes.
  `c.isVisible` above subscribes `CompanySection` to the whole state of `company`, its `dirty` included.

Source: `cube/react/nodeProps.test.tsx`, `cube/contract/sliceA/useForm.test.tsx` ("useForm(subtree)
— child components with independent subscriptions"), `cube/types.ts` (`UseForm`).

Outside render (event handlers, effects, non-React code) use the store itself:
`profileStore.getValues()` for a detached snapshot, `profileStore.setValues(patch)` or
`profileStore.proxy.company.name.value = "Acme"` to write, `profileStore.reset()` to start over.

### Choose the skill for the rest of the task

| The task involves | Read |
| --- | --- |
| A table or list of same-shaped items, add/remove rows, a list loaded from an API, filters, pagination | `palistor-lists` |
| A wizard, onboarding, checkout or any Next/Back sequence of steps | `palistor-flows` |
| Inputs from a UI kit or in-house inputs with other prop names (`required`, `error`, `helperText`) | `palistor-field-mapping` |
| The form or list must be in the server-rendered HTML (Next.js App Router): data fetched by a Server Component, translated labels, no hydration mismatch. Or a server-rendered app needs one store for all its pages (the signed-in user, a cart) | `palistor-ssr` |
| Fields, groups, validation, submit, loading data into a form | this skill |

```text
Same-shaped items in a collection?            → palistor-lists
The user moves through steps?                 → palistor-flows
Inputs expect props under other names?        → palistor-field-mapping
Rendered on the server with its data?         → palistor-ssr
Otherwise                                     → fields and groups (this skill)
```

## Common Mistakes

### CRITICAL — Form logic in `useState` / `useEffect` instead of the config

Wrong — it runs, but the rule now lives outside the store, so submit validation, `dirty`, `reset` and
persistence do not know about it:

```text
const [country, setCountry] = useState("");
useEffect(() => { setCity(""); }, [country]);   // cascade in an effect
const cityRequired = country !== "";            // rule in the component
```

Correct — the same behavior as config keys; the component keeps no state:

```ts
import { Palistor } from "palistor";

export const addressStore = new Palistor({
  config: {
    country: { value: "", setter: () => ({ city: "" }) },
    city: { value: "", isRequired: (values: { country: string }) => values.country !== "" },
  },
});
```

Why: the store is the single owner of form state; React is a rendering layer. Source: README "Idea",
`cube/core/cube.ts` (`write`, `rawError`).

### CRITICAL — A hidden field still blocks submit

Wrong: `iban: { value: "", isRequired: true, isVisible: byBank }`. With `method: "card"` the field is
hidden, yet `submit()` returns `{ success: false, errors: [{ path: "iban", message: "required" }] }`
and `onSubmit` never runs. Correct: `isRequired: byBank` — the same predicate, as in "Show a field
conditionally". Why: submit validates every field of the subtree, hidden ones included; only hidden
flow steps are exempt. Source: `cube/core/cube.ts` (`collectErrors`).

### HIGH — Passing `store.proxy` (or a part of it) to `useForm`

```tsx expect-error=TS2769
import { Palistor, useForm } from "palistor";

const store = new Palistor({ config: { profile: { name: { value: "" } } } });

export function Profile() {
  const profile = useForm(store.proxy.profile);
  return <span>{profile.name.value}</span>;
}
```

Correct: `const profile = useForm(store).profile;` — or receive the subtree as a prop from a parent
that called `useForm`. Why: `store.proxy` is the raw, untracked tree; it is branded so the call fails
to compile and throws at runtime. Source: `store/store/types.ts` (`RawStoreProxyMarker`),
`cube/react/useForm.ts`.

### HIGH — Reading state in render without `useForm`

Wrong: `<b>{invoiceStore.proxy.total.value}</b>` in a component — it renders once and never updates.
Correct: `const form = useForm(invoiceStore);` then `<b>{form.total.value}</b>`. Why: only the proxy
returned by `useForm` records which fields a component read; `store.proxy` and `store.getValues()` are
for code outside render. Source: `cube/react/useForm.ts`.

### HIGH — Expecting the whole form in a nested field's `values`

Wrong: inside the `company` group, `vatId: { isRequired: (values) => values.hasCompany }` — there
`values` is `{ name, vatId }`, so the rule is always false. Correct: keep the condition in the same
group as the field it governs, or put the flag on the group itself (a group's own `isVisible` sees
its parent's values). Why: config functions are scoped to the parent group. Source:
`cube/core/cube.ts` (`scopeValues`).

### HIGH — A number field fed by a text input

Wrong — `amount: { value: 0 }` bound to `<input>`: after typing, `getValues().amount` is the string
`"42"`, although the type says `number`. Correct: `amount: { value: 0, formatter: (raw: unknown) => Number(raw) || 0 }`.
Why: a write stores exactly what it receives unless a `formatter` converts it. Source:
`cube/core/cube.ts` (`write`).

### HIGH — Reading validity that is not there yet

Wrong: disabling Save with `disabled={form.isInvalid}` or `disabled={form.company.isInvalid}`, or
testing `field.isInvalid === false`. Before the first submit every `isInvalid` is `undefined`, and a
group's `isInvalid` reflects only the group's own `validate` / `isRequired`, never its children.
Correct: call `submit()` and use its result; show per-field errors from the field spread. Source:
`cube/core/cube.ts` (`isInvalid`, `revalidate`).

### MEDIUM — `useForm(store, selector)`

Wrong: `useForm(orderStore, (s) => s.address)`. Correct: `useForm(orderStore).address`. Why: the
two-argument form exists only for list entities (`useForm(entity, templateSelector)`, see
`palistor-lists`); with a store it throws. Source: `cube/react/useForm.ts` (`resolveEntity`).

### MEDIUM — Root submit where a group submit was meant

`store.submit()` / `form.submit()` validates the whole form and calls the root `onSubmit`;
`form.company.submit()` validates only `company`, calls its `onSubmit`, and reports error paths
relative to the group. A section with its own Save button needs the group call. Source:
`cube/core/cube.ts` (`submit`).

### MEDIUM — Changing the config object after the store exists

The config is read when the store is built; later edits to it are not picked up. Change state through
the store: `setValues`, `reset(values)`, `field.value = …`. For another shape, create another store.
Source: `cube/core/cube.ts` (constructor).

## Completion

1. `npx tsc --noEmit` passes in the consumer project.
2. Submitting the untouched form returns `{ success: false }`, shows `errorMessage` on each required
   field, and does not call `onSubmit`.
3. For every conditional field: with the field hidden, a correctly filled form submits successfully.
4. No component holds form values or rules in `useState` / `useEffect`; no `store.proxy` reaches
   `useForm`.

If a check fails, find the symptom in Common Mistakes first. If the API does not match what is written
here, the installed version differs: see Version below.

## References

- Read [config options](references/config-options.md) when you need a config key or callback argument
  that the table above does not spell out, or the order of the write and submit steps.
- Read [proxy and store API](references/proxy-api.md) when you need a property or method of a field,
  group or store that is not used in the examples above.
- Read [async resolve](references/async-resolve.md) before loading data into a form from an API:
  `resolve`, dependencies, loading state, retry, Suspense.
- Read [integrations](references/integrations.md) when the task mentions saving a draft
  (`usePersist`), translations (`useTranslator`), toasts for load errors (`useNotifier`) or data such
  as an account id that callbacks need but the form does not own (`useStoreContext`).
- Read [TypeScript](references/typescript.md) when you must type values, component props or callback
  arguments, or when a type error comes from a Palistor type.

## Version

Targets palistor v0.1.0-cube.1. If the project has another version installed, read the skill shipped
with that version instead: it is in `node_modules/palistor/skills/`, or run
`npm exec --no -- intent load palistor#palistor` (and `palistor#palistor-lists`,
`palistor#palistor-flows`, `palistor#palistor-field-mapping`, `palistor#palistor-ssr` for the other
skills).
