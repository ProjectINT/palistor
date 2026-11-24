# TypeScript

Let the store infer everything from the config literal; add types only at component boundaries.

## Infer, do not annotate

```ts
import { Palistor } from "palistor";
import type { ExtractValues, DeepPartialValues } from "palistor";

const config = {
  name: { value: "" },
  age: { value: 0 },
  address: { city: { value: "" }, country: { value: "US" } },
};

export type ProfileValues = ExtractValues<typeof config>;
// { name: string; age: number; address: { city: string; country: string } }

export const draft: DeepPartialValues<ProfileValues> = { address: { city: "Berlin" } };

export const profileStore = new Palistor({ config, initialValues: draft });
```

- Write `new Palistor({ config })` without type arguments. Both the config and an optional
  `fieldMapping` are inferred; passing only the first type argument disables inference of the second.
- Do not annotate the config as `FormConfig<…>`: the annotation widens the literal, and
  `ExtractValues`, `initialValues` and the proxy types lose precision.
- Widen a literal default where the field holds a union:
  `status: { value: "draft" as "draft" | "sent" }`.

## Annotate callback parameters

The config is inferred from its literal, so nothing gives a callback's parameters a type. In a
`strict` project every un-annotated one is error TS7006 ("implicitly has an 'any' type"). Annotate
each with an interface of the object that callback really receives:

```ts
import { Palistor } from "palistor";

interface DeliveryValues {
  method: "pickup" | "courier";
  address: string;
}

export const deliveryStore = new Palistor({
  config: {
    method: { value: "pickup" as DeliveryValues["method"] },
    address: {
      value: "",
      isRequired: (values: DeliveryValues) => values.method === "courier",
      validate: (value: string, values: DeliveryValues) =>
        values.method === "courier" && value.length < 5 ? "Too short" : undefined,
    },
  },
});
```

The annotation is not checked against the config, so it must describe the right object: the parent
group's values for `value` / `validate` / `setter` / the flags, the whole form for `formatter`, texts
and `onChange` (see the config options reference).

For a config **without groups** you can type every callback at once with `satisfies`, which keeps the
literal's precision:

```ts
import { Palistor } from "palistor";
import type { FormConfig } from "palistor";

interface LoginValues {
  email: string;
  remember: boolean;
}

const config = {
  email: { value: "", validate: (value, values) => (value || values.remember ? undefined : "Enter your email") },
  remember: { value: false },
} satisfies FormConfig<LoginValues>;

export const loginStore = new Palistor({ config });
```

`FormConfig` does not describe nested groups (a group's children are rejected as unknown keys), so in
a config with groups annotate the parameters instead.

## Type component props

`PalistorProxy<T>` builds the proxy type from a plain values interface, so a child component does not
import the config. (The type is exported as `PalistorProxy` because `Palistor` is the store class.)

```tsx
import { useForm } from "palistor";
import type { FieldProxyNode, PalistorProxy } from "palistor";

interface Address {
  city: string;
  zip: string;
}

// A section: receives a subtree, subscribes on its own.
export function AddressSection({ address }: { address: PalistorProxy<Address> }) {
  const a = useForm(address);
  return (
    <>
      <TextInput {...a.city} />
      <TextInput {...a.zip} />
    </>
  );
}

// An adapter: receives one field's spread.
export function TextInput({ value, onValueChange, label }: FieldProxyNode<string>) {
  return <input aria-label={label} value={value} onChange={(e) => onValueChange(e.target.value)} />;
}

// A one-field component: receives the field itself, subscribes on its own. `useForm` returns the same type.
export function CityField({ field }: { field: FieldProxyNode<string> }) {
  const f = useForm(field);
  return <TextInput {...f} />;
}
```

A node typed from the config is assignable to these props level after level without a cast
(`form.company` to `PalistorProxy<Company>`, `c.address` to `PalistorProxy<Address>`, `a.city` to
`FieldProxyNode<string>`). In a store with a `fieldMapping`, `useForm(field)` does not compile
(the renamed props are not a `FieldProxyNode`), although it runs; see `palistor-field-mapping`.

A number field's `value` reads as `number` but accepts `number | string` on write (and a boolean
field accepts `boolean | string | number`), because inputs produce strings. The conversion itself is
the field's `formatter`.

## Types by purpose

| Type | Use |
| --- | --- |
| `ExtractValues<typeof config>` | The values object: `getValues()`, submit payloads |
| `DeepPartialValues<T>` | `initialValues`, `setValues` / `reset` arguments, `setter` patches |
| `PalistorProxy<T>` | Props that receive a subtree of `useForm(...)`, built from a values interface |
| `ConfigProxy<typeof config>` | The exact type `useForm(store)` returns, when a prop takes the whole form |
| `FieldProxyNode<T>` | Props of an input adapter (one field's spread), or the prop of a one-field component that calls `useForm(field)` |
| `GroupProxyNode` | The members every group has (`submit`, `reset`, `values`, `dirty`, …) |
| `MaybeComputed<T, TValues>` | `T` or `(values) => T`: the type of flags and `value` in a config |
| `MaybeTranslatable<T, TValues>` | `T` or `(t, values) => T`: the type of `label` and other texts |
| `TranslateFn` | The translator accepted by `useTranslator` (next-intl, i18next, any `(...args) => string`) |
| `Resolve<T>`, `NotifyFn`, `ResolveErrorContext` | A `resolve` block, the notifier, the second argument of `onError`. The type declares `notify` only; at runtime the argument also carries `t`, the store's translator: see "Typing `onError`" in the async resolve reference |
| `PersistDriver`, `PersistOptions` | Draft storage contracts |
| `Unsubscribe` | Return type of `subscribeGlobal` |

List and entity types (`PalistorRef`, `PalistorList`, `InferEntity`, `TemplateConfig`, `ListResolver`,
and `FilterProxyNode` / `SortProxyNode`, the props of a filter panel and a sort header that `useForm`
also accepts) are covered by the `palistor-lists` skill, flow types (`FlowProxyNode`, `FlowStepProxy`, …) by
`palistor-flows`, and `FieldMapping` / `ApplyFieldMapping` by `palistor-field-mapping`.

## Typical errors

| Error | Cause and fix |
| --- | --- |
| `No overload matches this call` on `useForm(...)` mentioning `_PALISTOR_ERROR__do_not_pass_store_proxy_subtree_to_useForm…` | A `store.proxy` node was passed. Call `useForm(store)` and drill into its result |
| A field is missing on the proxy type, or its value is `unknown` | The config was annotated or cast (`as any`, `FormConfig`). Remove the annotation and let it infer |
| `import type { Palistor }` used for props | That is the store class. Use `PalistorProxy<T>` |
| Property `onError` is missing in a `resolve` block | It is required on group and field resolves |
| TS7006 `Parameter 'values' implicitly has an 'any' type` in a config | Annotate the callback parameter (section above) |
| TS2345 on `field.onValueChange(e.target.value)` | The field is a union (`"pickup" \| "courier"`): a write accepts only that union. Cast or look the option up: `e.target.value as Delivery` |
| TS2345 passing values declared as an `interface` to a function that takes `Record<string, unknown>` | An interface has no index signature. Declare the values as a `type` alias, or pass `{ ...values }` |
