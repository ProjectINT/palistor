# defineFlow v2 — Step-Based Flow Primitive for Palistor

## Status: RFC / Draft

## Design Principles

1. **Steps are groups** — each step is a regular Palistor group node, enriched with flow-specific fields (`status`, etc.)
2. **No rollback** — all step values are always preserved. User explicitly clears if needed (principle of preserving user input)
3. **Composition over invention** — reuse existing Palistor concepts: groups, `isVisible`, validation, `onSubmit`, `resolve`
4. **Array ordering** — steps are an ordered array; proxy supports both index and named access
5. **Navigation via parent argument** — Palistor's `onSubmit` already receives the node's parent proxy as its 3rd argument (`onSubmit(value, store, parent)`); for a step, the parent **is** the flow proxy with `nextStep`, `back`, `goTo` — no signature change needed
6. **Branching via `isVisible` + `goTo`** — linear flow skips hidden steps; arbitrary jumps via `goTo` in `onSubmit`
7. **User controls navigation** — the library doesn't auto-advance; user calls `nextStep()` / `goTo()` explicitly

---

## API: defineStep & defineFlow

### defineStep

Wraps a group config, attaching a key and marking it as a flow step. Internally mixes in flow-specific fields (e.g. `status`).

```ts
import { defineStep } from "palistor";

const welcome = defineStep("welcome", {
  name: { value: "", isRequired: true },
  age:  { value: null as number | null, isRequired: true },
});
// Returns the same group config, marked with key "welcome"
// At runtime, the flow exposes a computed `status` property on the step proxy
// (null → "active" → "completed")
```

### defineFlow

Wraps an ordered array of steps into a flow node. The flow node is a group in the Palistor config tree — it participates in `values`, `persist`, `dirty` like any other group.

```ts
import { defineFlow, defineStep } from "palistor";

const onboarding = defineFlow({
  steps: [
    defineStep("welcome", {
      name: { value: "", isRequired: true },
      age:  { value: null as number | null, isRequired: true },
    }),

    defineStep("goalSelection", {
      goal: { value: "", isRequired: true },

      // 3rd argument is the standard `parent` proxy — for a step, that's
      // the flow proxy. Navigation methods are bound, so destructuring works.
      onSubmit: async (values, store, { goTo, nextStep }) => {
        if (values.goal === "invest") goTo("riskAssessment");
        else if (values.goal === "save") goTo("savingsPlan");
        else goTo("summary");
      },
    }),

    defineStep("riskAssessment", {
      riskLevel: { value: "", isRequired: true },
      horizon:   { value: "5y" },

      // Branching via isVisible — step is skipped by nextStep() when hidden
      isVisible: (values) => values.goalSelection.goal === "invest",

      resolve: {
        resolver: async (values, store) => api.getRiskOptions(store.context.accountId),
        onError: (err, { notify }) => notify("Failed to load risk options"),
      },
    }),

    defineStep("savingsPlan", {
      monthlyAmount: { value: 0, isRequired: true },
      accountType:   { value: "standard" },
      isVisible: (values) => values.goalSelection.goal === "save",
    }),

    defineStep("summary", {
      // Read-only review step, no fields
    }),
  ],

  // Flow-level submit (all accumulated values)
  onSubmit: async (allValues, store) => {
    await api.completeOnboarding(allValues);
  },
});

const config = {
  promoCode: { value: "" },
  onboarding,
};
```

### What defineStep mixes in

Each step proxy gets an additional computed property, managed by the flow:

| Property | Type | Description |
|-------|------|-------------|
| `status` | `"active" \| "completed" \| null` | Reactive, read-only. Derived from navigation state |

`status` is **not** a leaf node with `value` — it is a computed proxy property (like `dirty`, `loading`, `submitting` on regular groups), derived from the flow's navigation state (`currentStepKey` + visited set). It therefore never appears in `values`, submit payloads, or persisted field values:
- `null` — step has not been visited (initial state for all steps except the first)
- `"active"` — current step
- `"completed"` — was active, then navigated away (forward or back)

The first step in the array starts with `status = "active"`. All other steps start with `status = null`.

### What defineFlow adds at the flow level

| Property | Type | Description |
|----------|------|-------------|
| `currentStepKey` | `string` | Key of the active step (reactive) |
| `currentStepIndex` | `number` | Index of the active step (reactive) |
| `canGoBack` | `boolean` | Reactive. `true` if the visit stack is non-empty |
| `loading` | `boolean` | Composite: `true` if **any** step has `loading === true` |
| `isInvalid` | `boolean` | Aggregate validation across visited steps |
| `dirty` | `boolean` | Any step field changed from initial |
| `steps` | `FlowSteps` | Array-like + named access + `.current` |
| `history` | `readonly string[]` | Reactive. Visit path: `[...visitStack, currentStepKey]` |
| `validate()` | `Array<{ path, message }>` | Validates visited steps; same error shape as `SubmitResult` (empty = valid) |
| `errors` | `Array<{ path, message }>` | Reactive. Errors from last `validate()` call or failed finalization |

---

## Flow Proxy API

```tsx
const form = useForm(store);
const flow = form.onboarding;

// ─── Flow-Level State ─────────────────────────────
flow.currentStepKey;       // "welcome" — reactive
flow.currentStepIndex;     // 0 — reactive
flow.canGoBack;            // visit stack non-empty — reactive
flow.loading;              // true if any step resolve is running
flow.dirty;                // any field in any step changed
flow.isInvalid;            // any visited step has validation errors

// ─── Navigation Methods ──────────────────────────
flow.nextStep();           // advance to next visible step (by array order)
flow.back();               // return to previous step (no-op if visit stack is empty)
flow.goTo("welcome");      // jump to step by key
flow.goTo(0);              // jump to step by index

// ─── Steps Access ────────────────────────────────
flow.steps[0];             // first step proxy (typed via tuple)
flow.steps.welcome;        // same step proxy (typed via key mapping)
flow.steps.current;        // direct reference to active step proxy (written on each navigation)
flow.steps.length;         // number of steps

// ─── Step-Level Proxy (enriched group) ───────────
flow.steps.welcome.status;        // "active" | "completed" | null
flow.steps.welcome.name.value;    // field access (typed)
flow.steps.welcome.isInvalid;     // group validation
flow.steps.welcome.loading;       // step resolve loading
flow.steps.welcome.submit();      // step submit → onSubmit's 3rd arg (parent) is the flow proxy
flow.steps.welcome.dirty;         // step-level dirty

// ─── Validation ──────────────────────────────────
flow.validate();           // validate visited steps → Array<{ path, message }> (empty = valid)
flow.errors;               // Array<{ path, message }> — reactive, from last validate()/finalize
flow.isInvalid;            // aggregate: true if any visited step has errors

// ─── Accumulated State ───────────────────────────
flow.values;               // { welcome: { name, age }, goalSelection: { goal }, ... }
                           // standard group property — live reference, not a clone
flow.submit();             // standard submit pipeline over all steps → flow-level onSubmit
flow.history;              // ["welcome", "goalSelection"] — reactive visit path
```

---

## Navigation Model

### nextStep()

1. Finds the next step in array order after `currentStepIndex`
2. Skips steps where `isVisible === false`
3. If no visible steps remain after current — finalizes the flow via `flow.submit()`: the standard submit pipeline (submitting → beforeSubmit → validate → onSubmit → afterSubmit) over all steps. Validation covers all **visible** steps; fields inside hidden steps are excluded — otherwise a skipped branch with `isRequired` fields would block finalization forever. On failure `onSubmit` is not called, errors land in `flow.errors`, and the flow stays on the current step
4. Sets previous step's `status = "completed"`, new step's `status = "active"`
5. Triggers `onEnter` of the new step (if defined)
6. Triggers `resolve` of the new step (if defined and not cached)
7. After resolve completes — triggers `onReady` of the new step (if defined)
8. Does **NOT** validate the current step — validation is the user's responsibility (via `submit()` pipeline or manual check)

### back()

1. If the visit stack is empty — no-op (use `flow.canGoBack` to disable the Back button)
2. Pops the last entry from the internal visit stack
3. Sets current step's `status = "completed"` (it was visited), previous step's `status = "active"`
4. Triggers `onEnter` of the target step
5. Triggers `resolve` of the target step (if defined and not cached)
6. After resolve completes — triggers `onReady` of the target step (if defined)

### goTo(keyOrIndex)

1. Resolves the target step by key (string) or index (number)
2. **Throws** if the key/index does not match any step — catches typos and logic bugs at development time
3. Sets current step's `status = "completed"`, target step's `status = "active"`
4. Pushes to visit stack
5. Triggers `onEnter` of the target step
6. Triggers `resolve` of the target step (if defined and not cached)
7. After resolve completes — triggers `onReady` of the target step (if defined)

### Visit Stack (internal)

An internal array tracking the navigation path: `["welcome", "goalSelection", "riskAssessment"]`. Used by `back()` to know where to return. Exposed via the reactive `flow.history` (`[...visitStack, currentStepKey]`). A separate visited set (keys of all steps ever entered) backs the `status` derivation — the stack alone is lossy because `back()` pops entries.

- `nextStep()` / `goTo()` → push current step key onto the stack
- `back()` → pop the stack

---

## Typical Patterns

### Pattern 1: Linear wizard — validate → submit → advance

```tsx
function WizardStep({ step, flow }) {
  return (
    <>
      {/* ... fields ... */}
      <button
        disabled={step.isInvalid}
        onClick={() => step.submit()}
      >
        Next
      </button>
    </>
  );
}

// In step config:
defineStep("welcome", {
  name: { value: "", isRequired: true },
  onSubmit: async (values, store, { nextStep }) => {
    await api.saveStep(values);
    nextStep();
  },
})
```

### Pattern 2: Branching — choose path in onSubmit

```ts
defineStep("goalSelection", {
  goal: { value: "", isRequired: true },
  onSubmit: async (values, store, { goTo }) => {
    if (values.goal === "invest") goTo("riskAssessment");
    else goTo("savingsPlan");
  },
})
```

### Pattern 3: Back button — no validation needed

```tsx
<button
  disabled={!flow.canGoBack}
  onClick={() => flow.back()}
>
  Back
</button>
```

Note: `currentStepIndex === 0` is **not** a reliable guard — after `goTo(0)` from a later step the index is 0 but the visit stack is non-empty, and `back()` is still meaningful. Use `canGoBack`.

### Pattern 4: Navigate without submit

```tsx
// Skip directly — no validation, no onSubmit
<button onClick={() => flow.goTo("summary")}>Skip to Summary</button>
```

### Pattern 5: Global loading state

```tsx
// Show global spinner if any step is resolving
if (flow.loading) return <GlobalSpinner />;
```

---

## Branching via isVisible

Steps with `isVisible: false` are skipped by `nextStep()`. This is the primary branching mechanism:

```ts
defineStep("riskAssessment", {
  isVisible: (values) => values.goalSelection.goal === "invest",
  // ...fields
})
```

When user is on `goalSelection` and calls `nextStep()`:
- If `goal === "invest"` → `riskAssessment.isVisible = true` → lands on `riskAssessment`
- If `goal === "save"` → `riskAssessment.isVisible = false`, `savingsPlan.isVisible = true` → skips to `savingsPlan`

For non-linear jumps (e.g. based on API response), use `goTo()` in `onSubmit`.

### isVisible and state

Hidden steps still hold their values. `flow.values` includes them. `persist` saves them. This is consistent with how `isVisible` works on regular Palistor groups — visibility is a UI concern, not a data concern. The one exception is submit-time validation: fields inside hidden steps are excluded (see Resolved Decision 14), otherwise a skipped branch could never pass finalization.

---

## onSubmit and Flow Navigation

No signature change is needed. Palistor's existing `onSubmit` signature is `onSubmit(value, store, parent)`, where `parent` is the node's **parent proxy** (see `submitPipeline.ts` — `onSubmit(value, this.kernel, view.parent.proxy)`). A step's immediate parent is the flow node, so the third argument **is** the flow proxy:

```ts
onSubmit: async (
  stepValues: StepValues,
  store: ProxyStore,
  flow: FlowProxy,   // = parent proxy of the step — standard 3rd argument
) => {
  // ... API call ...
  flow.nextStep();
}
```

Navigation methods (`nextStep`, `back`, `goTo`) are bound to the flow proxy, so destructuring works too: `onSubmit: (values, store, { nextStep }) => ...`.

This requires zero changes to the submit pipeline and stays consistent with the rest of Palistor: flow-level `onSubmit` likewise receives *its own* parent proxy as the third argument, like any group.

---

## values, Persist, Dirty

### values

Standard group property (live reference, like `GroupProxyNode.values`). Contains all step values regardless of current step or visit status. `status` is a computed property, not a leaf — it never appears here:

```ts
flow.values
// → {
//   welcome: { name: "Alice", age: 25 },
//   goalSelection: { goal: "invest" },
//   riskAssessment: { riskLevel: "", horizon: "5y" },  // even if not visited
//   savingsPlan: { monthlyAmount: 0, accountType: "standard" },
//   summary: {},
// }
```

Steps are just groups — `values` works identically to any Palistor group.

### Persist

`usePersist` works at the store level. The flow persists:
- All step field values (standard group persistence)
- Flow navigation state: `currentStepKey`, visit stack, visited step keys

Step statuses are **not** persisted — they are derived from navigation state (`"active"` = current, `"completed"` = in visited set, `null` otherwise). Entity lists already persist internal state alongside values; the flow follows the same mechanism.

On hydration, the flow restores to the exact state: same step active, same history.

### Dirty

`flow.dirty` is `true` if any field in any step has changed from its initial value. Per-step dirty: `flow.steps.welcome.dirty`. This is standard Palistor group dirty tracking — nothing flow-specific.

---

## Step Lifecycle

### onEnter

Called when a step becomes active (via `nextStep()`, `back()`, or `goTo()`):

```ts
defineStep("work", {
  // ...fields
  onEnter: async (values, store) => {
    analytics.track("entered_work_step");
  },
})
```

`onEnter` runs after the step's `status` is set to `"active"` and before `resolve` (if defined).

Both `onEnter` and `onReady` receive **flow-scoped** values — all steps keyed by step key (the same scope step-level `isVisible` gets). Note: this differs from `resolve.resolver`, which receives root store values (standard resolve behavior).

### onReady

Called after a step's `resolve` completes (or immediately after `onEnter` if no `resolve` is defined). Fires only once per resolve execution — if `back()` returns to a step with cached resolve data, `onReady` does **not** fire again:

```ts
defineStep("result", {
  overallScore: { value: 0 },
  resolve: {
    resolver: async (values, store) => {
      // resolver receives ROOT store values (standard resolve behavior) —
      // sibling steps are addressed by full path from the root
      const analysis = await api.analyze(values.speakingPractice.work.answers);
      return { overallScore: analysis.score };
    },
    onError: (err, { notify }) => notify("Analysis failed"),
  },
  onReady: async (values, store) => {
    // onReady receives flow-scoped values — resolved data is available here
    analytics.track("result_ready", { score: values.result.overallScore });
  },
})
```

Use `onReady` when you need access to resolved data. Use `onEnter` for fire-and-forget actions (analytics, logging) that don't depend on resolved data.

### Lifecycle order on step entry

1. Previous step `status → "completed"`
2. New step `status → "active"`
3. `onEnter(values, store)` — fire and forget (before resolve)
4. `resolve` triggers (if defined and deps changed / not cached)
5. Step `loading → true` during resolve
6. `onReady(values, store)` — called after resolve completes (or immediately after `onEnter` if no resolve). Fires only when resolve actually runs; skipped if resolve is cached

### Initialization lifecycle

On store creation, the first step starts with `status = "active"`. The full lifecycle fires for it:
1. First step `status = "active"`
2. `onEnter` fires
3. `resolve` triggers (if defined)
4. `onReady` fires (after resolve or immediately)

This is consistent — the first step is "entered" at creation time, so its lifecycle runs.

### resolve

Standard Palistor group resolve. Works per-step. Group resolve is lazy by default (`options.lazy: true` — waits for first access to the node); the flow triggers it **eagerly on step entry**, equivalent to a first access. "Not cached" means the resolve status is not `resolved` (a `pending` resolve is deduplicated by the existing pipeline):

```ts
defineStep("result", {
  overallScore: { value: 0 },
  resolve: {
    resolver: async (values, store) => {
      // ROOT store values — full path to the sibling step
      const analysis = await api.analyze(values.speakingPractice.work.answers);
      return { overallScore: analysis.score };
    },
    onError: (err, { notify }) => notify("Analysis failed"),
    deps: [],  // or specific dependencies
  },
})
```

---

## Composition: Flow + List + Regular Fields

Flow is a config tree node, just like `defineList`. Everything composes:

```ts
const config = {
  // Regular field alongside flow
  accountEmail: { value: "" },

  // Flow with list inside a step
  onboarding: defineFlow({
    steps: [
      defineStep("selectTeam", {
        members: defineList<TeamMember>({
          template: { id: { value: "" }, name: { value: "" }, role: { value: "viewer" } },
          resolve: { resolver: fetchTeamMembers, onError: handleError, deps: [] },
        }),
        onSubmit: async (values, store, { nextStep }) => {
          if (values.members.length > 0) nextStep();
        },
      }),
      defineStep("configure", {
        projectName: { value: "", isRequired: true },
      }),
      defineStep("done", {}),
    ],
  }),
};
```

### Flow inside List — not supported

If an entity in a list needs a multi-step flow, open it in a separate form (entity projection pattern) that contains a `defineFlow`. Reuse the existing `useForm(entity, template)` mechanism.

---

## Case Study: Onboarding with Branching

```ts
const onboarding = defineFlow({
  steps: [
    defineStep("welcome", {
      name: { value: "", isRequired: true },
      age:  { value: null as number | null, isRequired: true },
      onSubmit: async (values, store, { nextStep }) => {
        nextStep();
      },
    }),

    defineStep("goalSelection", {
      goal: { value: "", isRequired: true },
      onSubmit: async (values, store, { goTo }) => {
        if (values.goal === "invest") goTo("riskAssessment");
        else if (values.goal === "save") goTo("savingsPlan");
        else goTo("summary");
      },
    }),

    defineStep("riskAssessment", {
      riskLevel: { value: "", isRequired: true },
      horizon:   { value: "5y" },
      isVisible: (values) => values.goalSelection.goal === "invest",
      resolve: {
        resolver: async (values, store) => api.getRiskOptions(store.context.accountId),
        onError: (err, { notify }) => notify("Failed to load risk options"),
      },
      onSubmit: async (values, store, { goTo }) => {
        goTo("summary");
      },
    }),

    defineStep("savingsPlan", {
      monthlyAmount: { value: 0, isRequired: true },
      accountType:   { value: "standard" },
      isVisible: (values) => values.goalSelection.goal === "save",
      onSubmit: async (values, store, { goTo }) => {
        goTo("summary");
      },
    }),

    defineStep("summary", {
      // Read-only review step
    }),
  ],

  onSubmit: async (allValues, store) => {
    await api.completeOnboarding(allValues);
  },
});
```

### React Component

```tsx
function OnboardingWizard() {
  const form = useForm(store);
  const flow = form.onboarding;

  return (
    <>
      {flow.currentStepKey === "welcome" && (
        <WelcomeStep step={flow.steps.welcome} />
      )}
      {flow.currentStepKey === "goalSelection" && (
        <GoalStep step={flow.steps.goalSelection} />
      )}
      {flow.currentStepKey === "riskAssessment" && (
        <RiskStep step={flow.steps.riskAssessment} />
      )}
      {flow.currentStepKey === "savingsPlan" && (
        <SavingsStep step={flow.steps.savingsPlan} />
      )}
      {flow.currentStepKey === "summary" && (
        <SummaryStep
          values={flow.values}
          onSubmit={() => flow.submit()}
        />
      )}

      {/* Generic navigation */}
      <div className="nav">
        <button
          disabled={!flow.canGoBack}
          onClick={() => flow.back()}
        >
          Back
        </button>
        <StepIndicator
          steps={flow.steps}
          currentIndex={flow.currentStepIndex}
        />
      </div>
    </>
  );
}

function WelcomeStep({ step }: { step: PalistorProxy<WelcomeValues> }) {
  return (
    <div>
      <Input field={step.name} />
      <Input field={step.age} />
      <button
        disabled={step.isInvalid}
        onClick={() => step.submit()}
      >
        Continue
      </button>
    </div>
  );
}
```

---

## Case Study: Interactive Speaking Practice

```ts
const speakingPractice = defineFlow({
  steps: [
    defineStep("prep", {
      topic:            { value: "" },
      description:      { value: "", isReadOnly: true },
      totalQuestions:    { value: 0, isReadOnly: true },
      estimatedMinutes: { value: 0, isReadOnly: true },

      resolve: {
        resolver: async (values, store) => {
          const session = await api.getSpeakingSession(store.context.sessionId);
          return {
            topic: session.topic,
            description: session.description,
            totalQuestions: session.questions.length,
            estimatedMinutes: session.estimatedMinutes,
          };
        },
        onError: (err, { notify }) => notify("Failed to load session"),
      },
    }),

    defineStep("work", {
      currentIndex:    { value: 0 },
      subMode:         { value: "listening" as "listening" | "speaking" },
      timerEndAt:      { value: 0 },
      isRecording:     { value: false },
      currentQuestion: { value: "" },
      listenDuration:  { value: 30 },
      speakDuration:   { value: 60 },

      questions: defineList<Question>({
        template: {
          id:             { value: "" },
          text:           { value: "" },
          listenDuration: { value: 30 },
          speakDuration:  { value: 60 },
        },
        resolve: {
          resolver: async (_values, store) => {
            const session = await api.getSpeakingSession(store.context.sessionId);
            return session.questions;
          },
          onError: (err, { notify }) => notify("Failed to load questions"),
        },
      }),

      answers: defineList<AnswerRecord>({
        template: {
          id:         { value: "" },
          questionId: { value: "" },
          audioUrl:   { value: "" },
          transcript: { value: "" },
          duration:   { value: 0 },
        },
      }),

      onEnter: async (values, store) => {
        analytics.track("speaking_practice_started", { topic: values.prep.topic });
      },
    }),

    defineStep("result", {
      overallScore:    { value: 0 },
      fluencyScore:    { value: 0 },
      accuracyScore:   { value: 0 },
      feedback:        { value: "" },
      recommendations: { value: [] as string[] },

      resolve: {
        resolver: async (values, store) => {
          // ROOT store values — the flow lives at values.speakingPractice
          const answers = values.speakingPractice.work.answers;
          const analysis = await api.analyzeSpokenAnswers({
            sessionId: store.context.sessionId,
            answers,
          });
          return {
            overallScore: analysis.overall,
            fluencyScore: analysis.fluency,
            accuracyScore: analysis.accuracy,
            feedback: analysis.feedback,
            recommendations: analysis.recommendations,
          };
        },
        onError: (err, { notify }) => notify("Analysis failed"),
        options: { retry: { attempts: 2, delay: 2000 } },
      },

      onEnter: async () => {
        analytics.track("speaking_practice_completed");
      },
    }),
  ],
});
```

### React Component

```tsx
function SpeakingPractice() {
  const form = useForm(store);
  const flow = form.speakingPractice;
  const prep = flow.steps.prep;
  const work = flow.steps.work;
  const result = flow.steps.result;

  // ─── Preparation ──────────────────────────────
  if (flow.currentStepKey === "prep") {
    if (prep.loading) return <Skeleton />;

    return (
      <div className="prep-screen">
        <h1>{prep.topic.value}</h1>
        <p>{prep.description.value}</p>
        <div className="meta">
          <span>{prep.totalQuestions.value} questions</span>
          <span>~{prep.estimatedMinutes.value} min</span>
        </div>
        <button onClick={() => flow.nextStep()}>Start Practice</button>
      </div>
    );
  }

  // ─── Work: Listen ↔ Speak ─────────────────────
  if (flow.currentStepKey === "work") {
    const isListening = work.subMode.value === "listening";
    const isSpeaking  = work.subMode.value === "speaking";

    return (
      <div className="work-screen">
        <ProgressBar
          current={work.currentIndex.value + 1}
          total={prep.totalQuestions.value}
        />
        <CountdownTimer deadline={work.timerEndAt.value} onExpire={handleTimerExpire} />

        {isListening && (
          <div className="listen-phase">
            <SpeakerIcon animated />
            <p>{work.currentQuestion.value}</p>
            <button onClick={handleStartAnswer}>Answer Now</button>
          </div>
        )}

        {isSpeaking && (
          <div className="speak-phase">
            <MicrophoneVisualizer active={work.isRecording.value} />
            <button onClick={handleNextQuestion}>
              {isLastQuestion ? "Finish" : "Next Question →"}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ─── Result ───────────────────────────────────
  if (flow.currentStepKey === "result") {
    if (result.loading) {
      return <div><Spinner /><p>Analyzing your answers...</p></div>;
    }

    return (
      <div className="result-screen">
        <ScoreCard
          overall={result.overallScore.value}
          fluency={result.fluencyScore.value}
          accuracy={result.accuracyScore.value}
        />
        <p>{result.feedback.value}</p>
        <ul>
          {result.recommendations.value.map((rec, i) => <li key={i}>{rec}</li>)}
        </ul>
        <button onClick={() => flow.goTo("prep")}>Practice Again</button>
      </div>
    );
  }
}
```

### Timer-Driven Sub-Mode Transitions

The Listen ↔ Speak cycle within `work` happens via field value changes — not flow transitions. Both sub-modes share the same step state.

```ts
function handleTimerExpire() {
  const work = store.proxy.speakingPractice.steps.work;

  if (work.subMode.value === "listening") {
    work.subMode.value = "speaking";
    work.isRecording.value = true;
    work.timerEndAt.value = Date.now() + work.speakDuration.value * 1000;
    audioRecorder.start();
  } else {
    handleNextQuestion();
  }
}

async function handleNextQuestion() {
  const work = store.proxy.speakingPractice.steps.work;
  const flow = store.proxy.speakingPractice;
  const recording = await audioRecorder.stop();
  work.isRecording.value = false;

  work.answers.add({
    id: `ans_${Date.now()}`,
    questionId: work.questions.items[work.currentIndex.value].id.value,
    audioUrl: recording.url,
    transcript: await transcribe(recording),
    duration: recording.duration,
  });

  const nextIdx = work.currentIndex.value + 1;
  const total = work.questions.length;

  if (nextIdx >= total) {
    flow.nextStep(); // → moves to "result", triggers result.resolve
  } else {
    const nextQ = work.questions.items[nextIdx];
    work.currentIndex.value = nextIdx;
    work.currentQuestion.value = nextQ.text.value;
    work.listenDuration.value = nextQ.listenDuration.value;
    work.speakDuration.value = nextQ.speakDuration.value;
    work.subMode.value = "listening";
    work.timerEndAt.value = Date.now() + nextQ.listenDuration.value * 1000;
  }
}
```

---

## TypeScript Inference

### Tuple-based step typing

`defineFlow` accepts a tuple of steps. TypeScript preserves per-element types:

```ts
const flow = defineFlow({
  steps: [
    defineStep("welcome", { name: { value: "" }, age: { value: 0 } }),
    defineStep("goal",    { goal: { value: "" } }),
  ] as const,
});

// flow.steps[0] → { name: FieldProxy<string>, age: FieldProxy<number>, readonly status: StepStatus }
// flow.steps[1] → { goal: FieldProxy<string>, readonly status: StepStatus }
// flow.steps.welcome → same as [0]
// flow.steps.goal    → same as [1]
// flow.steps.current → direct reference to active step (union type of [0] | [1])
//                      written on each navigation; avoids explicit casting
```

### StepStatus

```ts
type StepStatus = "active" | "completed" | null;
// null = not yet visited, "active" = current step, "completed" = navigated away
```

### defineStep return type

```ts
function defineStep<
  K extends string,
  C extends Record<string, any>
>(key: K, config: C): FlowStep<K, C>;
```

### defineFlow return type

```ts
function defineFlow<
  S extends readonly FlowStep<string, any>[]
>(options: {
  steps: S;
  onSubmit?: (values: FlowValues<S>, store: ProxyStore) => Promise<unknown>;
}): FlowNode<S>;
```

### FlowValues — inferred from steps

```ts
type FlowValues<S extends readonly FlowStep[]> = {
  [Step in S[number] as Step["key"]]: ExtractValues<Step["config"]>;
};
```

### Proxy type for props

```ts
// Typed step prop in child component
function WelcomeStep({ step }: { step: PalistorProxy<{ name: string; age: number }> }) {
  return <Input field={step.name} />;
}
```

---

## isVisible values context

A step's `isVisible` receives the flow's accumulated values — all steps keyed by step name:

```ts
defineStep("riskAssessment", {
  // `values` = { welcome: { name, age }, goalSelection: { goal }, riskAssessment: {...}, ... }
  isVisible: (values) => values.goalSelection.goal === "invest",
})
```

This is consistent with how Palistor groups work: `isVisible` on a sub-group receives the parent's values. The flow is the parent; steps are its children.

---

## Reserved field names

The flow exposes `status` as a computed property on each step proxy. The name is reserved and cannot be used as a field name in step config — same as the implicitly reserved group proxy property names (`dirty`, `loading`, `submitting`, `values`, …). A field called `status` should produce a TypeScript error (conflicting types).

---

## Parallel with defineList

| | `defineList` | `defineFlow` |
|---|---|---|
| Models | Collection of homogeneous entities | Sequence of heterogeneous steps |
| Config marker | `defineList({ template, ... })` | `defineFlow({ steps: [...] })` |
| Step/Item helper | — | `defineStep(key, config)` |
| Proxy access | `.items[i]`, `.map()`, `.length` | `.steps[i]`, `.steps.key`, `.steps.current` |
| Async | list resolver → load entities | per-step resolve → load step data |
| Dirty | `itemIds !== initialItemIds` | any step field changed |
| Composite loading | `list.loading` | `flow.loading` (any step loading) |
| Navigation | — | `nextStep()`, `back()`, `goTo()` |
| Status | — | per-step `status` property (computed, `"active" \| "completed" \| null`) |

---

## Resolved Decisions

1. **Step status granularity** — Only `"active" | "completed" | null` are needed. No `"skipped"` or `"error"` statuses. `null` is the initial state for unvisited steps. First step starts as `"active"`. `status` is a computed proxy property derived from navigation state (`currentStepKey` + visited set), not a leaf node — it never appears in `values`, submit payloads, or persisted field values.

2. **onEnter timing** — `onEnter` runs immediately on step transition, before `resolve`. A new `onReady` callback runs after `resolve` completes, for cases that need resolved data.

3. **goTo to non-existent key** — Throws an error to catch typos and logic bugs at development time.

4. **nextStep() when no visible next step** — Hidden steps are skipped. If no visible steps remain ahead, `nextStep()` finalizes the flow via `flow.submit()` (the standard group submit pipeline). Step switching is done via status; visibility is business logic as it always was — allows hiding unnecessary steps based on user input.

5. **steps.current type narrowing** — On each navigation, a direct reference to the active step proxy is written to `steps.current`. This gives you a live reference without explicit casting.

6. **`as const` requirement** — Required for now to get proper tuple inference. Consider ergonomic API improvements later (helper function or overloads).

7. **Persist format** — JSON structure (field values kept pure; statuses derived, not stored):
```json
{
  "currentStepKey": "goalSelection",
  "visitStack": ["welcome"],
  "visitedKeys": ["welcome", "goalSelection"],
  "values": {
    "welcome": { "name": "Alice", "age": 25 },
    "goalSelection": { "goal": "" }
  }
}
```
On hydration: restore field values, `currentStepKey`, visit stack and visited keys; step statuses are recomputed from navigation state. `visitedKeys` is stored separately because the visit stack alone is lossy — `back()` pops entries, but a popped step remains "visited" (`status = "completed"`).

8. **Cross-step dependencies** — Works out of the box. Steps are groups in the config tree; any field can depend on any other field via standard Palistor dependency resolution.

---

## Resolved Decisions (continued)

9. **nextStep() auto-finalize behavior** — Finalization goes through `flow.submit()`, and the standard submit pipeline validates before calling `onSubmit`. If validation fails, `onSubmit` is not called; the errors (in `SubmitResult` shape) land in `flow.errors`. No validation logic is duplicated in the flow.

10. **onReady on back()** — `onReady` fires only when `resolve` actually executes. If `back()` returns to a step with cached resolve, `onReady` does not fire again. One execution is enough.

11. **steps.current initial value** — On store creation, the first step's full lifecycle fires (`onEnter` → `resolve` → `onReady`). This is logically consistent — the first step is "entered" at initialization.

12. **flow.validate() return type and delegation** — `flow.validate()` delegates to the same leaf-state collection the submit pipeline uses (`collectLeafStates` + `isInvalid`/`errorMessage` from computed field state). Returns `Array<{ path, message }>` — the same error shape as `SubmitResult`. Empty array = all valid. `path` lets the UI map each error to its step and field. On failure, the flow sets the same array on the reactive `flow.errors`.

13. **nextStep() finalize + validation failure** — When `nextStep()` auto-finalizes but validation fails: `onSubmit` is NOT called, errors land in `flow.errors` (reactive `Array<{ path, message }>`). The UI can display these. The flow stays on the current step.

14. **flow.validate() scope** — `flow.validate()` validates visited steps by default. At finalization time (`nextStep()` with no visible steps ahead), validation runs on all **visible** steps as a final safety check before calling `onSubmit`. Hidden steps are excluded: the base submit pipeline validates every leaf regardless of visibility (`collectLeafStates` has no `isVisible` filter, and `computeFieldState` marks empty `isRequired` fields invalid even when hidden), so the flow's validation must filter out leaves under hidden steps — otherwise the branch the user did not take would make finalization impossible. A visible but never-visited step (jumped over via `goTo`) **is** validated at finalization — that's the safety check working as intended.

15. **back() on empty visit stack** — No-op. `flow.canGoBack` (reactive, `visitStack.length > 0`) is exposed for the UI; `currentStepIndex === 0` is not a reliable guard because `goTo(0)` from a later step leaves the stack non-empty.

16. **flow.reset()** — Standard group reset of all step values, plus reset of navigation state: first step becomes `"active"`, visit stack and visited set are cleared, resolve states reset. The first step's entry lifecycle (`onEnter` → `resolve` → `onReady`) fires again, mirroring the initialization lifecycle.

17. **Current step hidden mid-flow** — If a dependency change flips the active step's `isVisible` to `false`, the flow does nothing automatically (principle 7: user controls navigation). The step stays active; `nextStep()` proceeds by array order as usual. Like all hidden steps, its fields are excluded from finalize validation if still hidden at that time.

---

## Open Questions

_(No open questions remaining.)_