---
name: palistor-flows
description: >
  Use when a React project that depends on palistor needs a form split into
  steps: a signup or onboarding wizard, a checkout, a survey or any screen with
  Next and Back; steps that appear only for some answers (branching); checking
  the current step before moving on and submitting everything at the end; a
  progress indicator with active and completed steps; restoring the user's step
  after a reload or restarting the wizard. Covers defineStep and defineFlow,
  flow navigation, step entry callbacks, flow validation, submit, reset,
  persisted navigation and typing flow and step props. Plain single-screen forms
  belong to the palistor skill, collections of items to palistor-lists.
metadata:
  purpose: 'Build step-by-step wizards with palistor flows: declare steps with
    defineStep, assemble them with defineFlow, drive navigation and branching,
    validate each step, finalize the whole flow and type flow and step props.'
  type: sub-skill
  library: palistor
  library_version: '0.1.0-cube.1'
sources:
  - 'ProjectINT/palistor:cube/defineFlow.ts'
  - 'ProjectINT/palistor:cube/core/flow.ts'
  - 'ProjectINT/palistor:cube/react/usePalistor.ts'
  - 'ProjectINT/palistor:store/flow/defineFlow.ts'
requires:
  - palistor
---

# Palistor flows: step-by-step wizards

Read the `palistor` skill first. This skill assumes its config → store → `useForm` → spread model and does not repeat it: a flow is a group whose children are the steps, and every step is a group.

## Setup

One module holds the flow, the store and the wizard container.

```tsx
import { Palistor, defineFlow, defineStep, useForm } from "palistor";
import type { FieldProxyNode } from "palistor";

type Plan = "free" | "pro" | "enterprise";

// A step's onSubmit receives the FLOW as its third argument.
const advance = (_values: unknown, _store: unknown, flow: { nextStep(): void }) => flow.nextStep();

const onboarding = defineFlow({
  steps: [
    defineStep("account", {
      // Widen every default with `as`: defineStep infers literals (see Common Mistakes).
      fullName: { value: "" as string, label: "Full name", isRequired: true },
      email: {
        value: "" as string,
        label: "Email",
        isRequired: true,
        validate: (v: string) => (v.includes("@") ? undefined : "Enter a valid email"),
      },
      onSubmit: advance,
    }),
    defineStep("plan", { plan: { value: "" as Plan | "", isRequired: true }, onSubmit: advance }),
    defineStep("company", {
      companyName: { value: "" as string, label: "Company", isRequired: true },
      // A step's isVisible reads the flow's values: every step by its key.
      isVisible: (values: { plan: { plan: Plan | "" } }) => values.plan.plan === "enterprise",
      onSubmit: advance,
    }),
    defineStep("summary", {}),
  ],
  // Runs on flow.submit() with the values of ALL steps, hidden ones included: shape the payload.
  onSubmit: async ({ account, plan, company }) =>
    api.completeOnboarding({ ...account, plan: plan.plan, ...(plan.plan === "enterprise" ? company : {}) }),
});

export const onboardingStore = new Palistor({ config: { onboarding } });

function Text(props: FieldProxyNode<string>) {
  const { isVisible, label, value, onValueChange, isInvalid, errorMessage } = props;
  if (!isVisible) return null;
  return (
    <label>
      {label}
      <input value={value} aria-invalid={isInvalid || undefined} onChange={(e) => onValueChange(e.target.value)} />
      {isInvalid ? <em>{errorMessage}</em> : null}
    </label>
  );
}

export function OnboardingWizard() {
  const flow = useForm(onboardingStore).onboarding;
  const key = flow.currentStepKey; // reactive, typed as the union of step keys
  const isLast = key === "summary";
  const plan = flow.steps.plan.plan;

  return (
    <div>
      {key === "account" && (
        <>
          <Text {...flow.steps.account.fullName} />
          <Text {...flow.steps.account.email} />
        </>
      )}
      {key === "plan" &&
        (["free", "pro", "enterprise"] as const).map((id) => (
          <label key={id}>
            <input type="radio" checked={plan.value === id} onChange={() => plan.onValueChange(id)} />
            {id}
          </label>
        ))}
      {key === "company" && <Text {...flow.steps.company.companyName} />}
      {key === "summary" && <pre>{JSON.stringify(flow.values, null, 2)}</pre>}

      <button disabled={!flow.canGoBack} onClick={() => flow.back()}>Back</button>
      <button
        disabled={flow.submitting}
        onClick={() => (isLast ? flow.submit() : flow.steps.current.submit())}
      >
        {isLast ? "Finish" : "Next"}
      </button>
    </div>
  );
}
```

Result: Next on an invalid step keeps the step and marks its fields; `company` is visited only on the enterprise plan; Finish runs the flow's `onSubmit` once.

Annotate every callback parameter inside `defineStep`: it gives its config no contextual types, so `validate: (v) => …`, `isVisible: (values) => …` or `onSubmit: (_v, _s, flow) => …` are implicit-`any` errors (TS7006 / TS7031) under `strict`. Type `values` by the scope table in "Branch by hiding a step" and the third `onSubmit` argument structurally, as `advance` does. `defineFlow`'s own `onSubmit` and `beforeSubmit` are typed for you.

## Core Patterns

### Validate the step on Next, finalize on the last step

`nextStep()` never validates. Validation on Next comes from submitting the step: `step.submit()` validates that step's fields and only then runs the step's `onSubmit`, which calls `nextStep()`.

| Call | Validates | Then |
| --- | --- | --- |
| `flow.steps.current.submit()` | the current step's fields | step `onSubmit(stepValues, store, flow)`; on errors nothing runs and the step stays |
| `flow.nextStep()` | nothing | next visible step; with none ahead it starts `flow.submit()` without awaiting it |
| `flow.validate()` | visited visible steps, hidden fields skipped | returns the errors and keeps them in `flow.errors`; submits nothing |
| `flow.submit()` | every visible step, visited or not | flow `onSubmit(allValues, store)`; errors land in `flow.errors` |

A failed `step.submit()` resolves to `{ success: false, errors }` with paths relative to the step; its fields then expose `isInvalid` and `errorMessage`. `flow.errors` stays empty: only `flow.validate()` and `flow.submit()` write it, with paths like `account.email`.

On the last step call `flow.submit()` yourself and read the result:

```tsx
import { Palistor, defineFlow, defineStep, useForm } from "palistor";

const store = new Palistor({
  config: {
    survey: defineFlow({
      steps: [defineStep("answers", { comment: { value: "" as string, isRequired: true } }), defineStep("review", {})],
      onSubmit: async (values) => api.sendSurvey(values.answers),
    }),
  },
});

export function FinishButton({ onDone }: { onDone: (id: unknown) => void }) {
  const flow = useForm(store).survey;
  const finish = async () => {
    try {
      const result = await flow.submit();
      if (result.success) onDone(result.result); // what the flow's onSubmit returned
      // else: result.errors === flow.errors, e.g. [{ path: "answers.comment", message: "required" }]
    } catch {
      // the flow's onSubmit threw (a failed request): submit() rejects and the wizard stays here
    }
  };
  return <button disabled={flow.submitting} onClick={finish}>Finish</button>;
}
```

A successful submit changes nothing in the flow: it stays on the last step and has no "submitted" flag. Keep the finished state in the caller (as `onDone` does) or in a final field-less step entered with `flow.goTo("done")`. A second `flow.submit()` while one is pending runs `onSubmit` again; `disabled={flow.submitting}` is the guard.

### Branch by hiding a step

Put `isVisible` on the step. `nextStep()` skips a hidden step, and `flow.submit()` and `store.submit()` do not validate it. Its values are still there: `flow.values`, `store.getValues()` and the `onSubmit` payload keep the values of every step, including a branch the user left. Shape the payload in the flow's `onSubmit`:

```ts
import { defineFlow, defineStep } from "palistor";

type Kind = "person" | "company";

export const signup = defineFlow({
  steps: [
    defineStep("kind", { kind: { value: "person" as Kind } }),
    defineStep("company", {
      vatId: { value: "" as string, isRequired: true },
      isVisible: (values: { kind: { kind: Kind } }) => values.kind.kind === "company",
    }),
    defineStep("done", {}),
  ],
  onSubmit: async ({ kind, company }) =>
    api.signup(kind.kind === "company" ? { ...kind, ...company } : kind),
});
```

What `values` means depends on where the function sits:

| Function | `values` it receives |
| --- | --- |
| step `isVisible`, `onEnter`, `onReady`, flow `onSubmit` | the flow's values: `{ [stepKey]: stepValues }` |
| a field's `isVisible`, `isRequired`, `validate`, computed `value`, `setter` | the values of the field's own parent group: its step, or a group nested in the step |
| step `onSubmit` | that step's values |
| step `resolve.resolver` | the root store values: `values.<flowKey>.<stepKey>` |

So a field cannot read another step. A condition that depends on an earlier step goes on a step: move the dependent fields into their own step and hide the step.

### Jump, go back, restart

- `flow.back()` pops the visit stack: it returns to the step the user came from, not to index − 1. It does nothing on an empty stack; bind the button to `flow.canGoBack`.
- `flow.goTo(keyOrIndex)` jumps and pushes the step being left onto the stack. An unknown key or index throws; the key is type-checked.
- `flow.history` is the visited path ending with the current step.
- `flow.reset()` returns to the first step, clears history, statuses, `flow.errors` and step resolve results, and resets the values; `flow.reset(values)` also makes `values` the new baseline. `store.reset()` and a `reset()` of any group above the flow do the same.
- `flow.steps.account.reset()` resets only that step's fields and keeps navigation.

### Show progress with step statuses

`flow.steps` gives a step by key (`flow.steps.account`), by index (`flow.steps[0]`), the active one (`flow.steps.current`), `length`, and iteration. Each step has `status`: `"active"`, `"completed"` (was active and was left, forward or back) or `null` (never visited). A step that was visited and then hidden keeps `"completed"`, so filter by `isVisible`:

```tsx
import { Palistor, defineFlow, defineStep, useForm } from "palistor";
import type { ConfigProxy } from "palistor";

const config = {
  checkout: defineFlow({
    steps: [
      defineStep("cart", { coupon: { value: "" as string } }),
      defineStep("gift", { note: { value: "" as string }, isVisible: (v: { cart: { coupon: string } }) => v.cart.coupon === "GIFT" }),
      defineStep("pay", {}),
    ],
  }),
};
export const store = new Palistor({ config });

// Type a whole-flow prop from the config.
type Checkout = ConfigProxy<typeof config>["checkout"];

function Progress({ flow }: { flow: Checkout }) {
  return (
    <ol>
      {[...flow.steps].filter((step) => step.isVisible).map((step, i) => (
        <li key={i} data-status={step.status ?? "pending"} />
      ))}
    </ol>
  );
}

export function CheckoutProgress() {
  return <Progress flow={useForm(store).checkout} />;
}
```

### Pass a step to a child component

Type the prop with `FlowStepProxy<typeof stepConfig>` (the step's config type, so hoist the config into a constant) or with `PalistorProxy<StepValues>`. Call `useForm(step)` in the child so it re-renders on its own reads.

```tsx
import { Palistor, defineFlow, defineStep, useForm } from "palistor";
import type { FlowStepProxy } from "palistor";

// A config declared as a constant keeps `string` — no `as` needed on defaults.
const accountConfig = { fullName: { value: "", isRequired: true } };
const store = new Palistor({
  config: { wizard: defineFlow({ steps: [defineStep("account", accountConfig), defineStep("done", {})] }) },
});

function AccountStep({ step }: { step: FlowStepProxy<typeof accountConfig> }) {
  const account = useForm(step);
  return <input value={account.fullName.value} onChange={(e) => account.fullName.onValueChange(e.target.value)} />;
}

export function Wizard() {
  const flow = useForm(store).wizard;
  return flow.currentStepKey === "account" ? <AccountStep step={flow.steps.account} /> : <p>Done</p>;
}
```

### Run code when a step opens

A step config accepts `onEnter(flowValues, store)` and `onReady(flowValues, store)` next to everything a group accepts. Entering a step runs `onEnter`, then starts the step's `resolve` if it has one and has not run, then `onReady` once that run settles (also after a failure; without a `resolve`, right after `onEnter`).

- The first step is entered when the store is created (for a module-level store, at module load) — in the browser. Where `window` is not defined (a server render, a Node script or test) no step is entered: `onEnter` and `onReady` are not called and no step `resolve` runs until `store.start()`, and the active step's `resolve` reads `loading: true` meanwhile. A test that expects `onEnter` in a `node` environment calls `store.start()` or creates the store with `new Palistor({ config, server: false })`.
- In a store made with `usePalistor` the first step is entered after the component's first commit, not during the render: the hook holds the store until then, so a render React throws away never runs `onEnter`. Do not expect `onEnter` to have run inside the first render. Source: `cube/ssr/usePalistor.test.tsx` ("the render starts nothing and reads what a server render reads; the effect starts everything once", "usePalistor: a render React throws away starts nothing", "new Palistor() outside the hook is not held: in the browser its constructor starts it").
- For a wizard that is rendered on the server (Next.js App Router), or a step whose data a Server Component already fetched, read `palistor-ssr`.
- Re-entering a step runs `onEnter` again. The resolve result is cached, so the resolver and `onReady` do not run again until the flow is reset.
- Both callbacks are fire-and-forget: a throw or a rejection is swallowed and never blocks navigation.
- `flow.loading` is true while any step's resolve is pending or about to start. Reading a step's `loading`, `status` or `isInvalid` never starts its resolve: the flow starts it on entry. For the `resolve` options themselves use the `palistor` skill.

### Keep the step across reloads

`usePersist(store, { key })` (see the `palistor` skill) saves each flow's navigation together with the values and restores it on hydration: the user lands on the saved step, statuses are re-derived, and that step's entry lifecycle runs. Step keys that no longer exist in the config are dropped. Navigation is saved even when `pick` or `omit` excludes the flow's values, so keep the flow's key persisted (Common Mistakes).

## Common Mistakes

### HIGH — Calling `flow.nextStep()` from the Next button

Wrong — the wizard advances over an empty required field:

```text
<button onClick={() => flow.nextStep()}>Next</button>
```

Correct: `onClick={() => flow.steps.current.submit()}` with an `onSubmit` that calls `flow.nextStep()` on every step (`advance` in Setup). `nextStep()` only picks the next visible step; validation belongs to the submit pipeline. Source: `cube/core/flow.ts` (`nextStep`), `cube/contract/sliceI/flowNavigation.test.ts`.

### HIGH — Inline step defaults without `as`

`defineStep` infers its config as literals, so `value: ""` types the field as `""`, `0` as `0`, `false` as `false`. Writes, `setValues`, `initialValues` and adapters typed `FieldProxyNode<string>` then fail to compile:

```ts expect-error=TS2322
import { Palistor, defineFlow, defineStep } from "palistor";

const store = new Palistor({
  config: { wizard: defineFlow({ steps: [defineStep("account", { fullName: { value: "" } })] }) },
});
store.proxy.wizard.steps.account.fullName.value = "Ada";
```

Correct: `fullName: { value: "" as string }` (also `0 as number`, `false as boolean`), or declare the step config as a constant before passing it to `defineStep`. Source: `store/flow/defineFlow.ts` (`defineStep<const K, const C>`).

### HIGH — A field-level condition that reads another step

Wrong — inside step `company`, `values` is `{ vatId }`, so `values.kind` is `undefined` and rendering the field throws a `TypeError`:

```text
defineStep("company", {
  vatId: { value: "" as string, isVisible: (values: any) => values.kind.kind === "company" },
})
```

Correct: put the condition on the step (`isVisible` on `defineStep("company", …)`), which receives the flow's values. Field functions get their parent group's values only; annotating `values` with that group's shape makes the compiler catch this. Source: `cube/core/cube.ts` (`scopeValues`), `cube/contract/sliceI/flowNavigation.test.ts` ("branching via isVisible").

### HIGH — A hidden required field inside a visible step

A hidden step is exempt from submit; a hidden field in a visible step is not. `flow.validate()` and `step.isInvalid` skip it, yet `step.submit()`, `flow.submit()` and `store.submit()` fail on it with an error no input shows.

```ts
import { defineStep } from "palistor";

type Delivery = { method: string; address: string };

export const delivery = defineStep("delivery", {
  method: { value: "pickup" as string },
  address: {
    value: "" as string,
    isVisible: (values: Delivery) => values.method === "courier",
    isRequired: (values: Delivery) => values.method === "courier", // same predicate as isVisible
  },
});
```

Give `isRequired` the same predicate as `isVisible`, and make `validate` return `undefined` while the field is hidden. Source: `cube/contract/sliceI/flowSurface.test.tsx` ("a hidden step is exempt, a hidden leaf in a visible step is not").

### HIGH — Sending the untaken branch to the server

Wrong: `onSubmit: async (values) => api.save(values)` in a branching flow. A step the user filled and then left by changing an earlier answer keeps its values in the payload. Correct: build the payload from the answers that select the branch, as in "Branch by hiding a step". Source: `cube/contract/sliceI/flowNavigation.test.ts` ("hidden steps keep their values and stay in flow.values").

### MEDIUM — Rendering `flow.errors` after a failed `step.submit()`

`flow.errors` is written by `flow.validate()` and `flow.submit()` only. After a failed Next the errors are on the fields (`isInvalid`, `errorMessage`) and in the promise's result. Render field errors in the inputs; use `flow.errors` for the final submit. Source: `cube/core/flow.ts` (`validate`, `submit`).

### MEDIUM — Typing a step prop as `FlowStepProxy<StepValues>`

`FlowStepProxy<C>` takes the step's config type. With a values interface every field becomes `never` and the real step is not assignable to the prop. Use `FlowStepProxy<typeof stepConfig>` or `PalistorProxy<{ fullName: string }>`; for the whole flow use `ConfigProxy<typeof config>["flowKey"]`. Source: `store/store/types.ts` (`FlowStepProxy`).

### MEDIUM — Steps that throw when the module loads

All of these throw at `defineStep` / `defineFlow`, i.e. on import:

- a `steps` entry that is a bare group object instead of `defineStep(key, config)`;
- a step config with a top-level `value` (that is a field) or a child named `status` (reserved for the computed step status);
- a duplicate step key, or one taken by the flow and group API: `values`, `steps`, `current`, `length`, `errors`, `history`, `validate`, `submit`, `reset`, `setValues`, `loading`, `dirty`, `label`, `description`, `resolve` and the other config keys.

Rename the step or the field. Source: `cube/defineFlow.ts`, `cube/contract/sliceI/defineFlow.test.ts`.

### MEDIUM — Reading the flow through `store.proxy` in a component

`store.proxy.wizard` is not subscribed: the component never re-renders on navigation, and passing it to `useForm` is rejected.

```tsx expect-error=TS2769
import { Palistor, defineFlow, defineStep, useForm } from "palistor";

const store = new Palistor({ config: { wizard: defineFlow({ steps: [defineStep("one", {})] }) } });

export function Wizard() {
  const flow = useForm(store.proxy.wizard);
  return <p>{flow.currentStepKey}</p>;
}
```

Correct: `const flow = useForm(store).wizard;`. `store.proxy.wizard.nextStep()` is fine in event handlers and outside React. Source: `react/useForm.ts` (`ForbidRawStoreProxy`), `cube/contract/sliceI/flowSurface.test.tsx`.

### MEDIUM — Looking for navigation methods on the step

The third argument of a step's `onSubmit` is the flow, not the step: `onSubmit: (_values: unknown, _store: unknown, { nextStep, goTo }: Nav) => …` with `type Nav = { nextStep(): void; goTo(step: string | number): void }`. The methods are bound, so destructuring works. The step's own values are the first argument. Source: `cube/contract/sliceI/flowNavigation.test.ts` ("a step's onSubmit receives the flow proxy").

### MEDIUM — A Back button that ignores `canGoBack`

`back()` on an empty visit stack does nothing, so an always-enabled Back looks broken on the first step. After `goTo(0)` the stack is not empty and Back returns to the step the user jumped from. Use `disabled={!flow.canGoBack}`. Source: `cube/contract/sliceI/flowNavigation.test.ts` ("back on an empty stack").

### MEDIUM — Expecting the current step in the values

Navigation is never a value: `currentStepKey`, history and statuses are absent from `flow.values`, `getValues()` and the submit payload. Read `flow.currentStepKey` when you need to send or log the step. Source: `cube/contract/sliceI/defineFlow.test.ts` ("status never enters values").

### MEDIUM — Persisting with a `pick` or `omit` that drops the flow

Navigation is stored apart from the values and ignores `pick` / `omit`. `usePersist(store, { key, pick: ["profile"] })` therefore restores the user to step 3 with steps 1–2 empty. Include the flow's key in `pick` (or leave it out of `omit`). Source: `cube/contract/sliceI/flowSurface.test.tsx` ("navigation alone autosaves under __flows[path], outside pick").

## Completion

1. `npx tsc --noEmit` in the consumer project passes with no `any` on the flow, its steps or their fields.
2. Walk every branch, by hand or in a test: Next on an invalid step keeps the step and marks its fields; a hidden step is skipped; Back follows the visited path; Finish calls the flow's `onSubmit` once with exactly the payload the server expects; `flow.errors` is empty after a successful submit.
3. If Finish does nothing, `await flow.submit()` and read `errors[].path` (`step.field`). The usual causes are a hidden required field and a visible step the user never opened.
4. If the app fails on import with `[palistor] defineFlow…` or `[palistor] defineStep…`, a step key or field name is reserved or a step was not built with `defineStep`.

## References

- Read [the flow API reference](references/flow-api.md) when you need a member not shown above: the full flow, steps-collection and step surfaces, the exported flow types, or the exact lifecycle and reset rules.
