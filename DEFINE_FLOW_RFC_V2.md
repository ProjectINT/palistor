# defineFlow v2 — Step-Based Flow Primitive for Palistor

## Status: RFC / Draft

## Design Principles

1. **Steps are groups** — each step is a regular Palistor group node, enriched with flow-specific fields (`status`, etc.)
2. **No rollback** — all step values are always preserved. User explicitly clears if needed (principle of preserving user input)
3. **Composition over invention** — reuse existing Palistor concepts: groups, `isVisible`, validation, `onSubmit`, `resolve`
4. **Array ordering** — steps are an ordered array; proxy supports both index and named access
5. **Navigation enrichment** — flow methods (`nextStep`, `back`, `goTo`) are passed to `onSubmit` callbacks
6. **Branching via `isVisible` + `goTo`** — linear flow skips hidden steps; arbitrary jumps via `goTo` in `onSubmit`
7. **User controls navigation** — the library doesn't auto-advance; user calls `nextStep()` / `goTo()` explicitly

---

## API: defineStep & defineFlow

### defineStep

Wraps a group config, attaching a key and marking it as a flow step. Internally mixes in flow-specific fields (e.g. `status`).

```ts
import { defineStep } from "@projectint/palistor";

const welcome = defineStep("welcome", {
  name: { value: "", isRequired: true },
  age:  { value: null as number | null, isRequired: true },
});
// Returns the same group config, marked with key "welcome"
// At runtime, defineFlow will mix in: status field (null → "active" → "completed")
```

### defineFlow

Wraps an ordered array of steps into a flow node. The flow node is a group in the Palistor config tree — it participates in `getValues`, `persist`, `dirty` like any other group.

```ts
import { defineFlow, defineStep } from "@projectint/palistor";

const onboarding = defineFlow({
  steps: [
    defineStep("welcome", {
      name: { value: "", isRequired: true },
      age:  { value: null as number | null, isRequired: true },
    }),

    defineStep("goalSelection", {
      goal: { value: "", isRequired: true },

      // onSubmit receives flow actions as 3rd argument
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

Each step group gets an additional field injected by the flow:

| Field | Type | Description |
|-------|------|-------------|
| `status` | `"active" \| "completed" \| null` | Reactive. Managed by flow navigation |

`status` is a regular Palistor leaf node with `value`. It reacts to navigation:
- `null` — step has not been visited (initial state for all steps except the first)
- `"active"` — current step
- `"completed"` — was active, then navigated away (forward or back)

The first step in the array starts with `status = "active"`. All other steps start with `status = null`.

### What defineFlow adds at the flow level

| Property | Type | Description |
|----------|------|-------------|
| `currentStepKey` | `string` | Key of the active step (reactive) |
| `currentStepIndex` | `number` | Index of the active step (reactive) |
| `loading` | `boolean` | Composite: `true` if **any** step has `loading === true` |
| `isInvalid` | `boolean` | Aggregate validation across visited steps |
| `dirty` | `boolean` | Any step field changed from initial |
| `steps` | `FlowSteps` | Array-like + named access + `.current` |
| `validate()` | `string[]` | Validates all visited steps; returns array of error messages (empty = valid) |
| `errors` | `string[]` | Reactive. Collected validation errors from last `validate()` call |

---

## Flow Proxy API

```tsx
const form = useForm(store);
const flow = form.onboarding;

// ─── Flow-Level State ─────────────────────────────
flow.currentStepKey;       // "welcome" — reactive
flow.currentStepIndex;     // 0 — reactive
flow.loading;              // true if any step resolve is running
flow.dirty;                // any field in any step changed
flow.isInvalid;            // any visited step has validation errors

// ─── Navigation Methods ──────────────────────────
flow.nextStep();           // advance to next visible step (by array order)
flow.back();               // return to previous step in visit history
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
flow.steps.welcome.submit();      // step submit → onSubmit gets flow actions
flow.steps.welcome.dirty;         // step-level dirty

// ─── Validation ──────────────────────────────────
flow.validate();           // validate all visited steps, returns string[] (empty = valid)
flow.errors;               // string[] — reactive, errors from last validate() call
flow.isInvalid;            // aggregate: true if any visited step has errors

// ─── Accumulated State ───────────────────────────
flow.getValues();          // { welcome: { name, age }, goalSelection: { goal }, ... }
flow.submit();             // flow-level onSubmit with all values
flow.history();            // ["welcome", "goalSelection"] — visit path (computed from statuses + visit stack)
```

---

## Navigation Model

### nextStep()

1. Finds the next step in array order after `currentStepIndex`
2. Skips steps where `isVisible === false`
3. If no visible steps remain after current — runs `flow.validate()` on **all** steps (final safety check). If valid (`errors` is empty) — calls flow-level `onSubmit` (finalizes the flow). If invalid — sets `flow.errors` with collected messages and stays on current step
4. Sets previous step's `status = "completed"`, new step's `status = "active"`
5. Triggers `onEnter` of the new step (if defined)
6. Triggers `resolve` of the new step (if defined and not cached)
7. After resolve completes — triggers `onReady` of the new step (if defined)
8. Does **NOT** validate the current step — validation is the user's responsibility (via `submit()` pipeline or manual check)

### back()

1. Pops the last entry from the internal visit stack
2. Sets current step's `status = "completed"` (it was visited), previous step's `status = "active"`
3. Triggers `onEnter` of the target step
4. Triggers `resolve` of the target step (if defined and not cached)
5. After resolve completes — triggers `onReady` of the target step (if defined)

### goTo(keyOrIndex)

1. Resolves the target step by key (string) or index (number)
2. **Throws** if the key/index does not match any step — catches typos and logic bugs at development time
3. Sets current step's `status = "completed"`, target step's `status = "active"`
4. Pushes to visit stack
5. Triggers `onEnter` of the target step
6. Triggers `resolve` of the target step (if defined and not cached)
7. After resolve completes — triggers `onReady` of the target step (if defined)

### Visit Stack (internal)

An internal array tracking the navigation path: `["welcome", "goalSelection", "riskAssessment"]`. Used by `back()` to know where to return. Exposed via `flow.history()`.

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
  disabled={flow.currentStepIndex === 0}
  onClick={() => flow.back()}
>
  Back
</button>
```

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

Hidden steps still hold their values. `getValues()` includes them. `persist` saves them. This is consistent with how `isVisible` works on regular Palistor groups — visibility is a UI concern, not a data concern.

---

## onSubmit Enrichment

Step-level `onSubmit` receives flow navigation actions as a third argument:

```ts
onSubmit: async (
  stepValues: StepValues,
  store: ProxyStore,
  flowActions: {
    nextStep: () => void;
    back: () => void;
    goTo: (keyOrIndex: string | number) => void;
  }
) => {
  // ... API call ...
  flowActions.nextStep();
}
```

This is a backwards-compatible extension. Existing `onSubmit` signatures (2 args) still work — the third argument is simply unused.

Flow-level `onSubmit` does NOT receive flow actions (it's the final submit of all data).

---

## getValues, Persist, Dirty

### getValues()

Returns all step values regardless of current step or visit status:

```ts
flow.getValues()
// → {
//   welcome: { name: "Alice", age: 25 },
//   goalSelection: { goal: "invest" },
//   riskAssessment: { riskLevel: "", horizon: "5y" },  // even if not visited
//   savingsPlan: { monthlyAmount: 0, accountType: "standard" },
//   summary: {},
// }
```

Steps are just groups — `getValues()` works identically to any Palistor group.

### Persist

`usePersist` works at the store level. The flow's entire state is persisted:
- All step field values
- `currentStepKey`
- Visit stack (for `back()` and `history()`)
- Step statuses (`"active" | "completed" | null`)

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

### onReady

Called after a step's `resolve` completes (or immediately after `onEnter` if no `resolve` is defined). Fires only once per resolve execution — if `back()` returns to a step with cached resolve data, `onReady` does **not** fire again:

```ts
defineStep("result", {
  overallScore: { value: 0 },
  resolve: {
    resolver: async (values, store) => {
      const analysis = await api.analyze(values.work.answers);
      return { overallScore: analysis.score };
    },
    onError: (err, { notify }) => notify("Analysis failed"),
  },
  onReady: async (values, store) => {
    // Resolved data is available here
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

Standard Palistor group resolve. Works per-step. Triggers on step entry if not cached:

```ts
defineStep("result", {
  overallScore: { value: 0 },
  resolve: {
    resolver: async (values, store) => {
      const analysis = await api.analyze(values.work.answers);
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
          values={flow.getValues()}
          onSubmit={() => flow.submit()}
        />
      )}

      {/* Generic navigation */}
      <div className="nav">
        <button
          disabled={flow.currentStepIndex === 0}
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
          const answers = values.work.answers;
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

// flow.steps[0] → { name: FieldProxy<string>, age: FieldProxy<number>, status: FieldProxy<StepStatus> }
// flow.steps[1] → { goal: FieldProxy<string>, status: FieldProxy<StepStatus> }
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

`defineStep` mixes `status` into each step group. This name is reserved and cannot be used as a field name in step config. If a user declares a field called `status`, it should produce a TypeScript error (conflicting types).

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
| Status | — | per-step `status` field (`"active" \| "completed" \| null`) |

---

## Resolved Decisions

1. **Step status granularity** — Only `"active" | "completed" | null` are needed. No `"skipped"` or `"error"` statuses. `null` is the initial state for unvisited steps. First step starts as `"active"`.

2. **onEnter timing** — `onEnter` runs immediately on step transition, before `resolve`. A new `onReady` callback runs after `resolve` completes, for cases that need resolved data.

3. **goTo to non-existent key** — Throws an error to catch typos and logic bugs at development time.

4. **nextStep() when no visible next step** — Hidden steps are skipped. If no visible steps remain ahead, `nextStep()` calls flow-level `onSubmit` (finalizes the flow). Step switching is done via status; visibility is business logic as it always was — allows hiding unnecessary steps based on user input.

5. **steps.current type narrowing** — On each navigation, a direct reference to the active step proxy is written to `steps.current`. This gives you a live reference without explicit casting.

6. **`as const` requirement** — Required for now to get proper tuple inference. Consider ergonomic API improvements later (helper function or overloads).

7. **Persist format** — JSON structure:
```json
{
  "currentStepKey": "goalSelection",
  "visitStack": ["welcome"],
  "steps": {
    "welcome": { "status": "completed", "name": "Alice", "age": 25 },
    "goalSelection": { "status": "active", "goal": "" }
  }
}
```
On hydration: restore `currentStepKey`, rebuild visit stack, set step statuses, restore field values.

8. **Cross-step dependencies** — Works out of the box. Steps are groups in the config tree; any field can depend on any other field via standard Palistor dependency resolution.

---

## Resolved Decisions (continued)

9. **nextStep() auto-finalize behavior** — `nextStep()` calls `flow.validate()` before finalizing. If validation fails, `onSubmit` is not called and the flow enters an error state with collected error messages.

10. **onReady on back()** — `onReady` fires only when `resolve` actually executes. If `back()` returns to a step with cached resolve, `onReady` does not fire again. One execution is enough.

11. **steps.current initial value** — On store creation, the first step's full lifecycle fires (`onEnter` → `resolve` → `onReady`). This is logically consistent — the first step is "entered" at initialization.

12. **flow.validate() return type and delegation** — `flow.validate()` delegates to each visited step's validation (runs the same validate logic as step-level submit). Returns `string[]` — an array of error messages collected from all steps. Empty array = all valid. This avoids duplicating validation logic between steps and flow. On failure, the flow sets `errors: string[]` on the flow proxy, which can be displayed in UI.

13. **nextStep() finalize + validation failure** — When `nextStep()` auto-finalizes but validation fails: `onSubmit` is NOT called, the flow collects error messages from `flow.validate()` into `flow.errors` (reactive `string[]`). The UI can display these. The flow stays on the current step.

14. **flow.validate() scope** — `flow.validate()` validates visited steps by default. At finalization time (`nextStep()` with no visible steps ahead), validation runs on **all** steps as a final safety check before calling `onSubmit`. This makes `flow.validate()` useful both as a manual check mid-flow (visited-only) and as a comprehensive gate at the end (all steps).

---

## Open Questions

_(No open questions remaining.)_