# Flow API reference

Every member below is read through `useForm(store).<flowKey>` in components (reactive) or through `store.proxy.<flowKey>` in handlers and outside React.

## Flow node

A flow node is a group node plus navigation. The group members (`isVisible`, `dirty`, `submitting`, `revalidate`, `setValues(patch)`, …) behave as described in the `palistor` skill; the rows below are what a flow adds or changes.

| Member | Type | Meaning |
| --- | --- | --- |
| `currentStepKey` | union of step keys | key of the active step |
| `currentStepIndex` | `number` | its index in `steps` order |
| `canGoBack` | `boolean` | the visit stack is not empty |
| `history` | `readonly string[]` | visit stack followed by the current step |
| `errors` | `ReadonlyArray<FlowError>` | result of the last `validate()` or `submit()`; paths relative to the flow (`account.email`) |
| `steps` | steps collection | see below |
| `values` | `FlowValues<S>` | live values of all steps keyed by step key, hidden steps included |
| `loading` | `boolean` | any step's resolve is pending |
| `isInvalid` | `boolean` | live: some visited, visible step has an error (no submit needed) |
| `nextStep()` | `void` | go to the next visible step; with none ahead start `submit()` without awaiting it |
| `back()` | `void` | pop the visit stack; no-op when it is empty |
| `goTo(keyOrIndex)` | `void` | jump; pushes the step being left; throws on an unknown key or index; no-op for the active step |
| `validate()` | `FlowError[]` | errors of visited visible steps (hidden fields and nested lists skipped); stored in `errors` |
| `submit()` | `Promise<SubmitResult>` | submit pipeline over every visible step; on failure `onSubmit` is not called and `errors` is filled; on success `errors` is cleared |
| `reset(values?)` | `void` | values back to defaults (or `values`), navigation back to the first step |

Navigation state is read-only: assigning `flow.currentStepKey` or a key of `flow.steps` throws. Navigation methods are stable references and work destructured.

## Steps collection (`flow.steps`)

| Access | Result |
| --- | --- |
| `flow.steps.account` | step by key |
| `flow.steps[0]` | step by index in `steps` order; `undefined` out of range |
| `flow.steps.current` | the active step; re-points on navigation |
| `flow.steps.length` | number of steps, hidden ones included |
| `[...flow.steps]` | all steps in order |

## Step node

A step is a group node (fields as children, `values`, `dirty`, `reset()`, `setValues()`, `submit()`) plus:

| Member | Type | Meaning |
| --- | --- | --- |
| `status` | `StepStatus` | `"active"`, `"completed"` (visited and left, forward or back) or `null` (never visited); never part of values |
| `isInvalid` | `boolean` | live: some visible field of this step has an error, whether or not the step was visited |
| `isVisible` | `boolean` | the step's own `isVisible`; `false` means `nextStep()` skips it and submits exempt it |
| `submit()` | `Promise<SubmitResult>` | validate this step (paths relative to the step), then its `onSubmit(stepValues, store, flow)` |

`status` is not included when a step is spread.

## Step entry lifecycle

Entering a step happens at store creation (first step), on `nextStep()` / `back()` / `goTo()`, after a reset that covers the flow, and after hydration onto a different step.

1. `onEnter(flowValues, store)`.
2. The step's `resolve`, if it has one and its state is idle. Reading `status` or `isInvalid` of a step never starts its resolve.
3. `onReady(flowValues, store)` when that resolve settles, with success or failure. Without a `resolve` it runs right after `onEnter`. With a resolve that already ran (cached) it does not run again.

Both callbacks are fire-and-forget; their errors are swallowed.

## Reset scope

| Call | Values | Navigation |
| --- | --- | --- |
| `flow.reset()`, `store.reset()`, `reset()` of a group above the flow | reset | first step, empty history, statuses cleared, `errors` cleared, step resolves idle again, first step entered again |
| `flow.steps.<key>.reset()` or a reset below a step | that subtree only | unchanged |

## Persisted navigation

With persistence enabled, each flow's navigation (`currentStepKey`, visit stack, visited keys) is saved next to the values under a reserved `__flows` key, addressed by the flow's path, and is not affected by `pick` / `omit`. On hydration unknown step keys are dropped; if the saved active step no longer exists, the flow keeps its current step. `__flows` never appears in `getValues()`.

## Field mapping

With a `fieldMapping` (see the `palistor-field-mapping` skill), flow and step nodes answer the external names of mapped group props (`dirty`, `loading`, `isInvalid`, …). Navigation members (`currentStepKey`, `errors`, `steps`, …) are never renamed.

## Exported types

| Type | Use |
| --- | --- |
| `FlowStep<K, C>` | result of `defineStep`: `{ key: K; config: C }` |
| `AnyFlowStep` | `FlowStep<string, Record<string, any>>` |
| `FlowNode<S>` | config node returned by `defineFlow`, branded with the step tuple `S` |
| `DefineFlowOptions<S>` | argument of `defineFlow`: `steps`, `onSubmit`, `beforeSubmit`, `afterSubmit` |
| `FlowValues<S>` | `{ [stepKey]: stepValues }`: type of `flow.values` and of the flow `onSubmit` argument |
| `FlowProxyNode<S, M>` | type of the flow node; derive it with `ConfigProxy<typeof config>["flowKey"]` rather than writing `S` by hand |
| `FlowStepsProxy<S, M>` | type of `flow.steps` |
| `FlowStepProxy<C, M>` | type of one step; `C` is the step's config type, not its values |
| `StepStatus` | `"active" \| "completed" \| null` |
| `FlowError` | `{ path: string; message: string }` |

`M` is the store's `fieldMapping` type and defaults to none.
