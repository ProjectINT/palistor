---
name: palistor-field-mapping
description: >
  Use when palistor fields have to be rendered through UI components in a React
  project: wiring a form to MUI, Ant Design, Chakra, HeroUI, shadcn or in-house
  inputs; writing or fixing a reusable text input, checkbox or select wrapper
  that receives a whole field through a JSX spread; making field props use the
  UI kit's names (required, disabled, error, helperText) with fieldMapping or
  defineFieldMapping; fixing React unknown-prop warnings, props leaking to the
  DOM, hidden fields that still render, inputs that do not update, or renamed
  props that lost their types. Covers one adapter per input kind, the
  single-vocabulary rule for mapped configs, typing adapter and subtree props,
  and the limits of renaming (names only, no value conversion). Field rules
  themselves (validation, visibility) belong to the palistor skill.
metadata:
  purpose: 'Connect palistor fields to a UI component library: one adapter
    component per input kind fed by a field spread, and fieldMapping /
    defineFieldMapping to rename field props to the vocabulary of the UI kit,
    with correct typing of the renamed props.'
  type: sub-skill
  library: palistor
  library_version: '0.1.0-cube.1'
sources:
  - 'ProjectINT/palistor:cube/core/mapping.ts'
  - 'ProjectINT/palistor:store/defineFieldMapping.ts'
  - 'ProjectINT/palistor:store/constants.ts'
requires:
  - palistor
---

# Palistor field mapping and input adapters

Read the `palistor` skill first. This skill assumes its config → store → `useForm` → spread model and does not repeat it; it covers the last hop, from a field to a UI component.

## Setup

First decide whether a mapping is needed. Compare the UI kit's prop names with palistor's (`value`, `onValueChange`, `label`, `placeholder`, `description`, `isRequired`, `isDisabled`, `isReadOnly`, `isInvalid`, `errorMessage`):

- They match (HeroUI style) → no `fieldMapping`; go to "Wrap a kit whose names already match".
- They differ (`required`, `disabled`, `error`, `helperText`: MUI, Ant Design, native HTML) → declare one map and use its names everywhere, as below.

```tsx
import { Palistor, defineFieldMapping, useForm } from "palistor";
import type { ApplyFieldMapping, FieldProxyNode } from "palistor";

// 1. One map per app: palistor's name → the name your UI kit uses.
export const fieldMapping = defineFieldMapping({
  isRequired: "required",
  isDisabled: "disabled",
  isReadOnly: "readOnly",
  isInvalid: "error",
  errorMessage: "helperText",
  description: "helpText",
});

// 2. The config is written in the SAME names: `required` / `helpText`,
//    never `isRequired` / `description`. Unmapped names (isVisible, label) stay as they are.
export const profileStore = new Palistor({
  config: {
    email: {
      value: "",
      label: "Email",
      required: true,
      helpText: "We never share it",
      validate: (v: string) => (v.includes("@") ? undefined : "Enter a valid email"),
    },
    nickname: { value: "guest_42", label: "Nickname", readOnly: true },
  },
  fieldMapping,
});

// 3. One adapter per input KIND. Its props are a whole field in the mapped names.
type TextProps = ApplyFieldMapping<FieldProxyNode<string>, typeof fieldMapping> & { type?: string };

export function TextInput(props: TextProps) {
  const { isVisible, label, value, onValueChange, placeholder, type } = props;
  const { required, disabled, readOnly, error, helperText, helpText } = props;
  if (!isVisible) return null; // a hidden field renders nothing
  return (
    <label>
      {label}
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        readOnly={readOnly}
        aria-invalid={error || undefined}
        onChange={(e) => onValueChange(e.target.value)}
      />
      <small>{error ? helperText : helpText}</small>
    </label>
  );
}

// 4. Every field is one spread; extra props sit next to it.
export function ProfileForm() {
  const form = useForm(profileStore);
  return (
    <>
      <TextInput {...form.email} type="email" />
      <TextInput {...form.nickname} />
    </>
  );
}
```

Result: `form.email.required` is `true` and typed, the spread carries the mapped names, and typing in the input updates the store. Annotate config callback parameters as in the `palistor` skill; to get them typed in a mapped config fragment, end the node with `satisfies ExternalConfigNode<typeof fieldMapping, TValue, TValues>`.

## Core Patterns

### Know what a field spread carries

`{...form.email}` has exactly these keys, under their mapped names when a map is active:

`value` · `label` · `placeholder` · `description` · `isRequired` · `isReadOnly` · `isDisabled` · `isVisible` · `isInvalid` · `errorMessage` · `onValueChange` · every key of the field's `componentProps` (never renamed)

- `value` and `onValueChange(next)` are both in the spread, so one adapter displays and edits. `onValueChange` takes the value, not an event, and is a stable reference.
- `isVisible` is always present. The adapter must consume it.
- `isInvalid` is `boolean | undefined` and `errorMessage` is `undefined` until the form shows errors; coerce with `!!` when the kit wants a strict boolean.
- `dirty`, `submitting` and `submit()` are not in the spread at runtime (the type lists them); read them by name.

### Wrap a kit whose names already match

No `fieldMapping`. The adapter consumes `isVisible` and forwards the rest:

```tsx
import { Input as KitInput } from "@heroui/react";
import type { ComponentProps } from "react";
import type { FieldProxyNode } from "palistor";

// The kit's own props that are not field props: type, size, …
type Extra = Omit<ComponentProps<typeof KitInput>, keyof FieldProxyNode<string>>;

export function Input(props: FieldProxyNode<string> & Partial<Extra>) {
  const { isVisible, ...rest } = props;
  if (!isVisible) return null;
  return <KitInput {...rest} isInvalid={!!rest.isInvalid} />;
}
```

### Wrap a kit with other names

Map the names once (Setup), then let the adapter do what a rename cannot: turn the change event into a value and pick the helper text. Destructure every prop the kit does not accept; forward the rest.

```tsx
import TextField from "@mui/material/TextField";
import type { ChangeEvent, ComponentProps } from "react";
import { defineFieldMapping } from "palistor";
import type { ApplyFieldMapping, FieldProxyNode } from "palistor";

export const fieldMapping = defineFieldMapping({
  isRequired: "required",
  isDisabled: "disabled",
  isInvalid: "error",
  errorMessage: "helperText",
  description: "helpText",
});

type FieldProps = ApplyFieldMapping<FieldProxyNode<string>, typeof fieldMapping>;
type Extra = Omit<ComponentProps<typeof TextField>, keyof FieldProps>;

export function Field(props: FieldProps & Partial<Extra>) {
  // isReadOnly is not a TextField prop: consume it and pass it the way your kit version expects.
  const { isVisible, onValueChange, error, helperText, helpText, isReadOnly, ...rest } = props;
  if (!isVisible) return null;
  return (
    <TextField
      {...rest}
      error={!!error}
      helperText={error ? helperText : helpText} // two sources, one prop: decided here
      onChange={(e: ChangeEvent<HTMLInputElement>) => onValueChange(e.target.value)}
    />
  );
}
```

### Convert value shapes inside the adapter

`fieldMapping` renames props one to one and never changes a value. Everything else lives in the adapter, so call sites stay a clean spread:

| Need | Example | Where |
| --- | --- | --- |
| Different value prop | checkbox `value` → `checked` | adapter |
| Event instead of value | `onChange(e)` → `onValueChange(e.target.value)` | adapter |
| Value transform | Ant Design `isInvalid: true` → `status: "error"` | adapter |
| Two sources, one prop | `helperText = error ? errorMessage : description` | adapter |
| Derived prop | `aria-invalid` from `isInvalid` | adapter |

```tsx
import type { FieldProxyNode } from "palistor";

export function Checkbox(props: FieldProxyNode<boolean>) {
  const { isVisible, value, onValueChange, label, isDisabled, errorMessage, description } = props;
  if (!isVisible) return null;
  const hint = errorMessage ?? description;
  return (
    <label>
      <input
        type="checkbox"
        checked={value}
        disabled={isDisabled}
        onChange={(e) => onValueChange(e.target.checked)}
      />
      {label}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}
```

### Declare the map so the renamed names stay typed

The map's values must stay literal types. Use `defineFieldMapping({...})` for a shared map (it also rejects keys that cannot be mapped); an inline literal in `new Palistor({ fieldMapping: {...} })` or `{...} as const` also work. Let the store infer both type parameters: write `new Palistor({ config, fieldMapping })`, or give both as `new Palistor<typeof config, typeof fieldMapping>(…)`.

### Type mapped props outside the adapter

```tsx
import { Palistor, defineFieldMapping, useForm } from "palistor";
import type { ApplyFieldMapping, ConfigProxy, FieldProxyNode } from "palistor";

const fieldMapping = defineFieldMapping({ isRequired: "required", isInvalid: "error" });
const config = { address: { city: { value: "", required: true } } };
export const store = new Palistor({ config, fieldMapping });

// One field: apply the map to the field type.
type CityProps = ApplyFieldMapping<FieldProxyNode<string>, typeof fieldMapping>;
// A subtree: derive it from the config and the map.
type Address = ConfigProxy<typeof config, typeof fieldMapping>["address"];

function City({ required, value }: CityProps) {
  return <span>{value}{required ? " *" : ""}</span>;
}

function AddressSummary({ address }: { address: Address }) {
  return <City {...address.city} />;
}

// A child that needs its own subscription calls useForm(store) and drills down.
export function AddressSection() {
  const address = useForm(store).address;
  return <AddressSummary address={address} />;
}
```

`PalistorProxy<Values, typeof fieldMapping>` types a subtree from a values interface instead of the config. In a mapped store do not call `useForm(subtree)` in children; see Common Mistakes.

### Know what a map renames

- Mappable names: `value`, `label`, `placeholder`, `description`, `isRequired`, `isReadOnly`, `isDisabled`, `isVisible`, `isInvalid`, `errorMessage`, `dirty`, `loading`, `onValueChange`. Anything not listed in the map keeps its name.
- You write the first eight in configs, under their mapped names. `isInvalid`, `errorMessage`, `dirty`, `loading` and `onValueChange` are computed: they are read under the mapped name and never written in a config.
- Groups, lists, flows and list items answer the mapped names for their own props (`dirty`, `loading`, `isInvalid`, …). Methods and structure are never renamed: `submit`, `reset`, `values`, list `items` / `add` / `error` / `resolveStatus`, pagination members, flow navigation.
- With `{ isInvalid: "error" }`, `.error` on a field or group is the validity flag, while `.error` on a list stays the load error.
- Field keys are never renamed: `getValues()`, submit payloads and error paths use the config's keys.
- The old names still resolve at runtime but are removed from the types; do not rely on them.

## Common Mistakes

### HIGH — Config written in palistor's names while a map is active

With a map, the config speaks the map's names. The original name of a renamed key is a compile error and makes `new Palistor` throw `[palistor] fieldMapping is active: write "required" instead of internal "isRequired" in config.` — at module load, so the screen never renders.

```ts expect-error=TS2322
import { Palistor, defineFieldMapping } from "palistor";

const fieldMapping = defineFieldMapping({ isRequired: "required", description: "helpText" });

export const store = new Palistor({
  config: { email: { value: "", isRequired: true, description: "We never share it" } },
  fieldMapping,
});
```

Correct: `email: { value: "", required: true, helpText: "We never share it" }`. The rule covers every config the store receives: nested groups, list templates, filter fields, flow steps, and config fragments shared between stores with different maps. A config hidden behind `as any` or built dynamically passes the compiler and still throws. Source: `cube/core/mapping.ts` (`normalize`), `cube/contract/sliceH/skillExample.test.ts`.

### HIGH — Spreading a field where palistor-only props are not consumed

Wrong — on a DOM element, or on a kit component that forwards unknown props to one:

```text
<input {...form.email} />
```

React warns about `isVisible`, `onValueChange`, `errorMessage` (or their mapped names), a hidden field still renders, and the input is read-only because `onValueChange` is not `onChange`. Correct: spread into an adapter that destructures `isVisible` (early `return null`), `onValueChange` and every prop the target does not accept, as in Setup. Source: `cube/contract/sliceH/fieldMapping.test.tsx` ("only external names are visible in a spread").

### HIGH — Wiring props by hand for every field

Wrong:

```text
<TextInput value={form.email.value} onChange={(v) => { form.email.value = v; }}
  required={form.email.required} error={form.email.error} helperText={form.email.helperText} />
```

Correct: `<TextInput {...form.email} />`. The spread already carries the value, the setter and every flag; hand-wired call sites drift apart and silently drop `isVisible` or `disabled`. Bind by hand only for a one-off control with no adapter. Source: `store/constants.ts` (`SPREADABLE_FIELD_STATE_PROPS`).

### HIGH — Two palistor props mapped to one name

Wrong: `{ errorMessage: "helperText", description: "helperText" }`. Nothing rejects it, at compile time or at run time; one prop silently replaces the other and the hint or the error never shows. Correct: give each prop its own name and merge them in the adapter (`error ? helperText : helpText`). Source: `cube/core/mapping.ts` (`FieldMap` constructor).

### HIGH — A field named like a mapped name

With `{ isDisabled: "disabled", description: "helpText", isInvalid: "error" }` active, a child field called `disabled` or `helpText` is read as that prop of its parent group, so it is no longer a field: it is silently missing from `getValues()` and from the submit payload. A child called `error` or `helperText` (computed names) throws `… is computed and cannot be set in config`. Rename the field (`isBlocked`, `hint`) or choose another mapped name. Source: `cube/core/mapping.ts` (`normalize`).

### HIGH — A map that loses its literal types

An annotation widens the map to "every key may be renamed", and every config then fails to compile with a misleading message about `value`:

```ts expect-error=TS2322
import { Palistor } from "palistor";
import type { FieldMapping } from "palistor";

const fieldMapping: FieldMapping = { isRequired: "required" };

export const store = new Palistor({ config: { email: { value: "", required: true } }, fieldMapping });
```

`{...} satisfies FieldMapping` is worse: it compiles, but the renamed props collapse into a string index, so `form.email.requierd` and any other typo type-check. Correct: `defineFieldMapping({...})`, `as const` or an inline literal. Source: `store/defineFieldMapping.ts`.

### HIGH — `new Palistor<typeof config>(…)` with a map

An explicit first type argument turns off inference of the second one, so the map's type is lost and the renamed names do not exist on the proxy:

```ts expect-error=TS2551
import { Palistor, defineFieldMapping } from "palistor";

const fieldMapping = defineFieldMapping({ isRequired: "required" });
const config = { email: { value: "", required: true } };

const store = new Palistor<typeof config>({ config, fieldMapping });
export const required = store.proxy.email.required;
```

Correct: `new Palistor({ config, fieldMapping })`, or both arguments. Source: `store/store/types.ts` (`ProxyStoreOptions`), `cube/contract/sliceH/fieldMapping.test.tsx` ("static typing").

### MEDIUM — `useForm(subtree)` in a mapped store

When the map renames a prop that groups also have (`isRequired`, `isDisabled`, `isReadOnly`, `isVisible`, `isInvalid`, `errorMessage`, `dirty`, `loading`), the subtree overload of `useForm` no longer accepts a mapped group. It works at run time but does not compile:

```tsx expect-error=TS2769
import { Palistor, defineFieldMapping, useForm } from "palistor";

const fieldMapping = defineFieldMapping({ isRequired: "required" });
const store = new Palistor({ config: { address: { city: { value: "" } } }, fieldMapping });

export function AddressSection() {
  const address = useForm(useForm(store).address);
  return <span>{address.city.value}</span>;
}
```

Correct: call `useForm(store)` in the child and drill down (`useForm(store).address`). Each `useForm(store)` call subscribes only to what that component reads, so the child still re-renders independently. Source: `react/useForm.ts` (overloads).

### MEDIUM — Expecting the map to convert values

`fieldMapping` cannot produce Ant Design's `status: "error"`, MUI's merged `helperText` or a checkbox's `checked`: it renames, nothing more. Do the conversion in the adapter ("Convert value shapes inside the adapter"). Source: `cube/core/mapping.ts` (`project`).

### MEDIUM — A new adapter for every field

Wrong: `EmailInput`, `PhoneInput`, `NameInput`, each re-implementing the same wiring. Correct: one adapter per input kind (text input, checkbox, select, date picker), typed `FieldProxyNode<T> & Partial<Extra>` (wrapped in `ApplyFieldMapping` when mapped). Per-field differences come from the config (`label`, `placeholder`, `componentProps`) and from extra props next to the spread. Source: `cube/contract/sliceH/fieldMapping.test.tsx` ("componentProps keys are preserved").

### MEDIUM — Renaming a prop to a name lists own

`new Palistor` throws when a map's target is a list member: `filter`, `values`, `fullLength`, `sort`, `page`, `pageSize`, `pageCount`, `total`, `serverTotal`, `hasNextPage`, `hasPrevPage`, `isFetching`, `isInitialLoading`, `isPreviousData`, `refetch`, `invalidate`, `prefetch` and the other pagination members. So `{ loading: "isFetching" }` is rejected; use `isLoading`. Source: `cube/core/mapping.ts` (`RESERVED_LIST_KEYS`).

## Completion

1. `npx tsc --noEmit` in the consumer project passes, with no `as any` on field spreads or on renamed props.
2. Render the form and check the browser console: no React warning about an unrecognized prop (`isVisible`, `onValueChange`, `helperText`, …) and none about a `value` without `onChange`.
3. Check behavior: a field whose `isVisible` is false leaves no element in the DOM; typing changes `store.getValues()`; after a failed `submit()` the kit shows its error state and the message.
4. If `new Palistor` throws, read the message: `write "x" instead of internal "y"` → rename that key in the config; `is computed and cannot be set in config` → remove the key or rename the colliding field; `reserved list key` → pick another target name.
