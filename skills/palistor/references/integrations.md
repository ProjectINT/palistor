# Integrations: drafts, translations, notifications, context

Four hooks connect a store to the application. Call each once, in a layout or provider component
that stays mounted while the form is in use.

The translator, the notifier and the context can also be given to the constructor —
`new Palistor({ config, translator, notifier, context })` — and are then in place before the first
render. `useTranslator`, `useNotifier` and `useStoreContext` register theirs in an effect, after it.
When the first HTML must already be translated (a screen rendered on the server), or the store is
created per component instance, read the `palistor-ssr` skill: `usePalistor` and
`<PalistorProvider>` replace these three hooks there.

## Save a draft — `usePersist`

```tsx
import { Palistor, useForm, usePersist, localStorageDriver } from "palistor";

const orderStore = new Palistor({ config: { email: { value: "" }, cardNumber: { value: "" } } });

export function OrderPage({ orderId }: { orderId: string }) {
  usePersist(orderStore, {
    key: `order-${orderId}`,
    driver: localStorageDriver, // or sessionStorageDriver, or your own PersistDriver
    debounce: 300,              // ms; default 100, 0 = write immediately
    omit: ["cardNumber"],       // top-level keys to leave out; or `pick` to list the ones to keep
    onError: (error, phase) => console.warn("draft", phase, error), // "save" | "hydrate"
  });
  const form = useForm(orderStore);
  return <TextField {...form.email} />;
}
```

- On mount the hook reads the stored snapshot and applies it, then saves after every change; on
  unmount it flushes and stops.
- It reconnects when the store, `key` or `driver` changes.
- A successful `submit()` of the root or of any group removes the stored draft.
- The snapshot contains the form values, list membership and wizard navigation.
- `pick` / `omit` take top-level keys only; when `pick` is set, `omit` is ignored.
- Without a hook: `store.persist.enable(options)` (returns a promise that settles after hydration),
  `flush()`, `clear()`, `disable()`, `hydrate()`, `isEnabled()`.

A custom driver is three methods, sync or async:

```ts
import type { PersistDriver } from "palistor";

export const memoryDriver = (): PersistDriver => {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
  };
};
```

## Translate texts — `useTranslator`

```tsx
import { Palistor, useTranslator } from "palistor";

const orderStore = new Palistor({ config: { email: { value: "" }, cardNumber: { value: "" } } });

export function I18nBridge({ t }: { t: (key: string) => string }) {
  useTranslator(orderStore, t); // pass a stable function: the hook re-registers when it changes
  return null;
}
```

In the config, texts and messages take `t`:

```ts
import { Palistor } from "palistor";
import type { TranslateFn } from "palistor";

export const signupStore = new Palistor({
  config: {
    email: {
      value: "",
      label: (t: TranslateFn) => t("signup.email"),
      placeholder: (t: TranslateFn) => t("signup.emailPlaceholder"),
      validate: (value: string, _values: unknown, t: TranslateFn) =>
        value.includes("@") ? undefined : t("errors.email"),
    },
  },
});
```

Without a registered translator `t` returns its key, which is enough for tests. Switching the
translator re-renders the components whose translated texts changed. The hook registers after the
first render, so that render — and any HTML rendered on the server — shows the keys; the
`translator` constructor option does not have that gap.

## Show load errors — `useNotifier`

```tsx
import { useCallback } from "react";
import { Palistor, useNotifier } from "palistor";

const orderStore = new Palistor({ config: { email: { value: "" }, cardNumber: { value: "" } } });

export function NotifyBridge() {
  const notify = useCallback((message: string) => toast.error(message), []);
  useNotifier(orderStore, notify);
  return null;
}
```

The registered function is what a resolver's `onError(error, { notify })` receives. You choose its
signature; with none registered `notify` does nothing. It is not called for validation errors or for
a failing `onSubmit`.

## Give callbacks outside data — `useStoreContext`

For data callbacks need but the form does not own (account id, tenant, permissions):

```tsx
import { Palistor, useStoreContext } from "palistor";

const orderStore = new Palistor({ config: { email: { value: "" }, cardNumber: { value: "" } } });

export function AccountBridge({ accountId }: { accountId: string }) {
  useStoreContext(orderStore, { accountId });
  return null;
}
```

- Read it as `store.context.accountId` in `resolver`, `onSubmit` and other callbacks that receive
  `store`.
- `setContext(patch)` merges into the current context. Outside React call
  `orderStore.setContext({ accountId })`, or pass `context` to `new Palistor({ config, context })`.
- Context is not form state: it is absent from `getValues()`, submit payloads and persisted drafts,
  and changing it does not re-render components.
- A resolver that read a context key re-runs when that key changes. Declare
  `contextDeps: ["accountId"]` on a resolve that must not start before the key is set.
