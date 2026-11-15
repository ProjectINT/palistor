# Async resolve: loading data into a form

A `resolve` block on a **group** loads values into that group and re-runs when what it read changes.
(A list has its own resolve, and a field can have one only inside a list template: both are in the
`palistor-lists` skill.)

## Declare it

```tsx
import { Palistor, useForm } from "palistor";
import type { ProxyStore, ResolveErrorContext } from "palistor";

interface UserFormValues {
  userId: string;
  profile: { name: string; email: string };
}

export const userStore = new Palistor({
  config: {
    userId: { value: "" },
    profile: {
      name: { value: "" },
      email: { value: "" },
      resolve: {
        // `values` is the WHOLE form (not just `profile`). Every read is a dependency,
        // including reads after an `await`. Return a patch for this group.
        resolver: async (values: UserFormValues, store: ProxyStore<any>) => {
          const user = await api.getUser(values.userId, store.context.accountId);
          return { name: user.name, email: user.email };
        },
        onError: (_error: unknown, { notify }: ResolveErrorContext) => notify("Could not load the profile"), // required
      },
    },
  },
});

export function Profile() {
  const form = useForm(userStore);
  const profile = form.profile;
  const name = profile.name.value; // reading a child starts the lazy resolve
  if (profile.loading) return <Spinner />;
  return <b>{name}</b>;
}
```

## Behavior

- **Start.** Lazy by default: the first read of the group's children or `value` through a proxy
  starts it. Reading `loading` alone does not. `options: { lazy: false }` starts it when the store is
  created.
- **Result.** The returned object patches the group's fields and becomes their baseline, so loaded
  data is not `dirty`. Returning `undefined` changes nothing.
- **Re-run.** When any value or `store.context` key the last run read changes, the resolver runs
  again by itself. A change that arrives while a run is in flight triggers one more run afterwards.
- **`loading`** is `true` while a run is pending.
- **Failure.** After the retries, `onError(error, { notify })` is called; `notify` is the function
  registered with `useNotifier` (a no-op if none). A group exposes no `error` property: keep failure
  state yourself if the UI must show it (for example set a field from `onError`).
- **Writes.** Assigning to `values.someField` inside the resolver is buffered and applied together
  with the result.

## Options

| Key | Meaning |
| --- | --- |
| `deps: ["userId"]` | Paths from the form root that restart the resolver even before its first run has read them |
| `contextDeps: ["accountId"]` | Context keys that must be non-null before a run starts; until then the resolve waits. Use it when context arrives after the first render |
| `optimisticResolver: (values) => patch` | Synchronous placeholder applied when a run starts |
| `options.lazy` | `true` (default): start on first read. `false`: start on store creation |
| `options.retry` | `{ attempts, delay }` — extra attempts before `onError`; `delay` in ms |
| `options.suspense` | `true`: reading the group while the run is pending throws its promise for React `<Suspense>` |

With `suspense: true`, render the reading component under a boundary instead of checking `loading`:

```tsx
import { Suspense } from "react";

export function ProfilePage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Profile />
    </Suspense>
  );
}
```

## Mistakes

### HIGH — Omitting `onError`

`onError` is required on a group (and field) resolve; the config does not type-check without it:

```ts expect-error=TS2741
import type { Resolve } from "palistor";

export const resolve: Resolve<{ name: string }> = {
  resolver: async () => ({ name: "Ann" }),
};
```

Add `onError: (error: unknown, { notify }: ResolveErrorContext) => notify("…")`. Source:
`store/resolvePipeline/types.ts`.

### HIGH — Loading in `useEffect` and writing with `setValues`

It works once, but the load does not re-run when its inputs change, has no `loading` flag and marks
the form dirty. Put the request in `resolve`: dependencies, `loading`, retry and the dirty baseline
come with it. Source: `cube/core/resolve.ts`.

### MEDIUM — Expecting the group's own values in `resolver`

`values` is the whole form: read `values.profile.name`, not `values.name`, for the group's own field.
Source: `cube/core/resolve.ts` (`execute`).

### MEDIUM — Waiting for a resolve that nothing reads

A lazy resolve does not start until a component (or code through `store.proxy`) reads the group's
fields. Rendering only `loading` shows `false` forever. Read a field, or set `options.lazy: false`.
Source: `cube/core/cube.ts` (`touch`), `cube/core/node.ts`.
