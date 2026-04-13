# defineFlow — Branching Flow Primitive for Palistor

## Status: RFC / Concept

## Problem

Palistor covers forms and entity lists well. But interactive modules — quizzes, onboarding wizards, multi-step surveys with branching — require an **async, multi-variant pipeline** where the user navigates forward/back through a dynamic graph of steps.

Today this is achievable via groups + `isVisible` + manual `step` field, but the transition logic is scattered across setters, there's no navigation history, no rollback strategy for abandoned branches, and no step lifecycle.

## What Palistor Already Covers

~60-70% of wizard/quiz scenarios work today:

- **Step = group** with fields, validation, resolve, submit
- **Conditional rendering** via `isVisible: (values) => values.step === "welcome"`
- **Per-group validation** — can't submit a group until valid
- **Resolve per step** — load data on step entry
- **Setter** — change `step` + reset dependent fields

## What's Missing

| Problem | Current State |
|---------|---------------|
| Transition graph | Implicit — scattered across `setter`/`onChange` |
| History (go back) | Manual `history: { value: [] }` field |
| Rollback on branch change | None — abandoned values linger |
| Progress indicator | Not computable — branches are dynamic |
| onEnter / onLeave lifecycle | None |

## Proposal: `defineFlow`

A new config primitive alongside leaf nodes and `defineList`. Lists model **collections of homogeneous entities**; flows model **sequences of heterogeneous steps with branching**.

### Basic Declaration

```ts
import { defineFlow } from "@projectint/palistor";

const onboarding = defineFlow({
  initial: "welcome",

  steps: {
    welcome: {
      // Each step is a regular Palistor group with all capabilities
      name: { value: "", isRequired: true },
      age:  { value: null as number | null, isRequired: true },
    },
    goalSelection: {
      goal: { value: "", isRequired: true },
    },
    riskAssessment: {
      riskLevel: { value: "", isRequired: true },
      horizon:   { value: "5y" },
      resolve: {
        resolver: async (values, store) => api.getRiskOptions(store.context.accountId),
        onError: (err, { notify }) => notify("Failed to load risk options"),
      },
    },
    savingsPlan: {
      monthlyAmount: { value: 0, isRequired: true },
      accountType:   { value: "standard" },
    },
    summary: {}, // read-only review step, no fields
  },

  // Declarative transition graph
  transitions: {
    welcome:        (values) => values.welcome.age! >= 18 ? "goalSelection" : null,
    goalSelection:  (values) => {
      if (values.goalSelection.goal === "invest") return "riskAssessment";
      if (values.goalSelection.goal === "save")   return "savingsPlan";
      return "summary";
    },
    riskAssessment: () => "summary",
    savingsPlan:    () => "summary",
    // summary has no transition → terminal step
  },

  // What to do with abandoned branch values
  rollback: "clear-abandoned", // "keep-all" | "clear-abandoned" | custom fn

  // Flow-level submit (all accumulated values)
  onSubmit: async (allValues, store) => {
    await api.completeOnboarding(allValues);
  },
});

const config = {
  // Regular form fields alongside flow — everything in one tree
  promoCode: { value: "" },
  onboarding,
};
```

## Flow Proxy API

```tsx
function OnboardingWizard() {
  const form = useForm(store);
  const flow = form.onboarding;

  // ─── Navigation ─────────────────────────
  flow.currentStep;     // "welcome" | "goalSelection" | ...
  flow.history;         // ["welcome", "goalSelection"] — visited stack
  flow.canGoNext;       // boolean: current step valid + transition exists
  flow.canGoBack;       // boolean: history.length > 0
  flow.isTerminal;      // boolean: no transition from current step
  flow.progress;        // { current: 2, estimated: 4 } — branch-aware estimate

  await flow.next();    // validate current step → compute transition → push history
  flow.back();          // pop history → return (previous step values preserved)
  flow.goTo("welcome"); // jump only to visited steps (otherwise ignored)

  // ─── Current Step Fields ────────────────
  flow.current;              // proxy of the current step group
  flow.current.name.value;   // fields as usual
  flow.current.isInvalid;    // step validation
  flow.current.loading;      // step resolve

  // ─── Accumulated State ──────────────────
  flow.getValues();          // { welcome: { name, age }, goalSelection: { goal }, ... }
  await flow.submit();       // onSubmit with all values

  return (
    <>
      {flow.currentStep === "welcome" && <WelcomeStep step={flow.current} />}
      {flow.currentStep === "riskAssessment" && <RiskStep step={flow.current} />}
      {/* ... */}
      <button disabled={!flow.canGoBack} onClick={() => flow.back()}>Back</button>
      <button disabled={!flow.canGoNext} onClick={() => flow.next()}>Next</button>
    </>
  );
}
```

## Step Lifecycle

```ts
steps: {
  riskAssessment: {
    riskLevel: { value: "" },

    // Step lifecycle hooks
    onEnter: async (values, store) => {
      // Called on next()/goTo() into this step
      analytics.track("entered_risk_step");
    },
    onLeave: async (values, direction, store) => {
      // direction: "forward" | "back"
      // return false to block the transition
      if (direction === "forward" && !values.riskLevel) return false;
    },
  },
}
```

## Rollback Strategies

When a user changes branches (e.g. went `welcome → goalSelection("invest") → riskAssessment`, then returned to `goalSelection` and chose `"save"` — `riskAssessment` is abandoned):

| Strategy | Behavior |
|----------|----------|
| `"keep-all"` | Abandoned step values preserved. If user returns — everything intact |
| `"clear-abandoned"` | Values reset to initial. Clean step on re-entry |
| `(abandoned, values) => patch` | Custom — e.g. clear only specific fields |

## Composition: Flow + List + Form

Flow is a config tree node, just like list. They nest inside each other:

```ts
const config = {
  // Regular form field
  accountEmail: { value: "" },

  // List inside a flow step
  onboarding: defineFlow({
    initial: "selectTeam",
    steps: {
      selectTeam: {
        members: defineList<TeamMember>({
          template: { id: { value: "" }, name: { value: "" }, role: { value: "viewer" } },
          resolve: { resolver: fetchTeamMembers, onError: handleError, deps: [] },
        }),
      },
      configure: {
        projectName: { value: "", isRequired: true },
      },
      done: {},
    },
    transitions: {
      selectTeam: (v) => v.selectTeam.members.length > 0 ? "configure" : null,
      configure: () => "done",
    },
  }),
};
```

## Parallel with defineList

| | `defineList` | `defineFlow` |
|---|---|---|
| Models | Collection of homogeneous entities | Sequence of heterogeneous steps |
| Config | `[template, listConfig?]` | `{ steps, transitions, initial }` |
| Proxy API | `items`, `add`, `remove`, `map` | `current`, `next`, `back`, `history` |
| Async | list resolver → load entities | step resolve → load step data |
| Dirty | `itemIds !== initialItemIds` | visited steps changed / values changed |
| Reactivity | `list.loading`, `list.length` | `flow.currentStep`, `flow.canGoNext` |

## Benefits vs. Separate State Manager for Wizard

1. **Single state tree** — flow fields participate in persist, dirty, getValues like everything else
2. **Cross-cutting dependencies** — fields outside flow can depend on answers inside flow and vice versa (`isVisible`, `dependencies`)
3. **Resolve/submit pipelines** — already exist, work per-step
4. **Validation on transition** — `next()` triggers group validation of current step, blocks if `isInvalid`
5. **Proxy reactivity** — subscribing only to `flow.currentStep` doesn't re-render on step field changes

## Case Study: Interactive Speaking Practice

A real-world scenario that showcases flow with timers, sub-modes, async analysis, and automatic transitions — an oral interview module where the system asks questions and listens to the user's spoken answers.

### Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│   ┌───────────┐      ┌──────────────────────────┐     ┌──────────┐ │
│   │           │      │         WORK             │     │          │ │
│   │   PREP    │ start│  ┌─────────┐ ┌────────┐  │ end │  RESULT  │ │
│   │           │─────▶│  │ LISTEN  │→│ SPEAK  │  │────▶│          │ │
│   │  intro +  │      │  │ (system │ │ (user  │  │     │ analysis │ │
│   │  config   │      │  │  asks)  │ │ answers│  │     │ + advice │ │
│   │           │      │  └────┬────┘ └───┬────┘  │     │          │ │
│   └───────────┘      │       │    next  │       │     └──────────┘ │
│                      │       ◀──────────┘       │                  │
│                      │       │                  │                  │
│                      │  repeat until last Q     │                  │
│                      └──────────────────────────┘                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Phase Breakdown

**1. Preparation** — Static screen. System displays topic description, estimated duration, number of questions. User reads and clicks "Start" when ready.

**2. Work** — Timer-driven alternation between two sub-modes:
- **Listening**: System plays/shows a question. Countdown timer runs. When the timer ends or user clicks "Answer" — transition to Speaking.
- **Speaking**: User records their answer. They can finish early ("Next Question") or wait for the time limit. After speaking — if more questions remain, cycle back to Listening. If that was the last question — auto-advance to Result.

**3. Result** — System sends all recorded answers for async analysis. While processing — loading state. On completion — displays scores, interpretation, and personalized advice.

### defineFlow Config

```ts
import { defineFlow, defineList } from "@projectint/palistor";

interface Question {
  id: string;
  text: string;
  listenDuration: number; // seconds to display the question
  speakDuration: number;  // seconds allowed for the answer
}

interface AnswerRecord {
  id: string;
  questionId: string;
  audioUrl: string;
  transcript: string;
  duration: number;
}

const speakingPractice = defineFlow({
  initial: "prep",

  steps: {
    // ─── Phase 1: Preparation ──────────────────────────────────
    prep: {
      topic:       { value: "" },
      description: { value: "", isReadOnly: true },
      totalQuestions: { value: 0, isReadOnly: true },
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
    },

    // ─── Phase 2: Work (Listen ↔ Speak cycle) ─────────────────
    work: {
      // Current position in the question sequence
      currentIndex:    { value: 0 },
      subMode:         { value: "listening" as "listening" | "speaking" },
      timerEndAt:      { value: 0 },     // epoch ms — when current phase expires
      isRecording:     { value: false },

      // The question being asked right now
      currentQuestion: { value: "" },
      listenDuration:  { value: 30 },
      speakDuration:   { value: 60 },

      // All questions loaded at step entry
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

      // Collected answers
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
        // Start the first question's listen phase
        analytics.track("speaking_practice_started", { topic: values.prep.topic });
      },
    },

    // ─── Phase 3: Result ───────────────────────────────────────
    result: {
      overallScore:   { value: 0 },
      fluencyScore:   { value: 0 },
      accuracyScore:  { value: 0 },
      feedback:       { value: "" },
      recommendations: { value: [] as string[] },

      resolve: {
        resolver: async (values, store) => {
          // Send all answers for AI analysis
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
        onError: (err, { notify }) => notify("Analysis failed. Please try again."),
        options: {
          retry: { attempts: 2, delay: 2000 },
        },
      },

      onEnter: async () => {
        analytics.track("speaking_practice_completed");
      },
    },
  },

  transitions: {
    prep: () => "work",
    work: (values) => {
      // Auto-advance when all questions answered
      const total = values.prep.totalQuestions;
      const answered = values.work.answers.length;
      return answered >= total ? "result" : null; // null = stay (not all answered yet)
    },
    // result → no transition (terminal)
  },

  rollback: "keep-all", // no branching here — linear flow
});
```

### React Component

```tsx
function SpeakingPractice() {
  const form = useForm(store);
  const flow = form.speakingPractice;

  // ─── Preparation ──────────────────────────────────────────
  if (flow.currentStep === "prep") {
    const prep = flow.current;

    if (prep.loading) return <Skeleton />;

    return (
      <div className="prep-screen">
        <h1>{prep.topic.value}</h1>
        <p>{prep.description.value}</p>
        <div className="meta">
          <span>{prep.totalQuestions.value} questions</span>
          <span>~{prep.estimatedMinutes.value} min</span>
        </div>
        <button onClick={() => flow.next()}>Start Practice</button>
      </div>
    );
  }

  // ─── Work: Listen ↔ Speak ─────────────────────────────────
  if (flow.currentStep === "work") {
    const work = flow.current;
    const isListening = work.subMode.value === "listening";
    const isSpeaking  = work.subMode.value === "speaking";

    return (
      <div className="work-screen">
        <ProgressBar
          current={work.currentIndex.value + 1}
          total={form.speakingPractice.steps.prep.totalQuestions.value}
        />

        <CountdownTimer deadline={work.timerEndAt.value} onExpire={handleTimerExpire} />

        {isListening && (
          <div className="listen-phase">
            <SpeakerIcon animated />
            <p className="question-text">{work.currentQuestion.value}</p>
            <button onClick={handleStartAnswer}>Answer Now</button>
          </div>
        )}

        {isSpeaking && (
          <div className="speak-phase">
            <MicrophoneVisualizer active={work.isRecording.value} />
            <p className="prompt">Your turn — speak your answer</p>
            <button onClick={handleNextQuestion}>
              {isLastQuestion ? "Finish" : "Next Question →"}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ─── Result ───────────────────────────────────────────────
  if (flow.currentStep === "result") {
    const result = flow.current;

    if (result.loading) {
      return (
        <div className="analyzing">
          <Spinner size="lg" />
          <p>Analyzing your answers...</p>
        </div>
      );
    }

    return (
      <div className="result-screen">
        <ScoreCard
          overall={result.overallScore.value}
          fluency={result.fluencyScore.value}
          accuracy={result.accuracyScore.value}
        />
        <section className="feedback">
          <h2>Feedback</h2>
          <p>{result.feedback.value}</p>
        </section>
        <section className="recommendations">
          <h2>What to improve</h2>
          <ul>
            {result.recommendations.value.map((rec, i) => (
              <li key={i}>{rec}</li>
            ))}
          </ul>
        </section>
        <button onClick={() => flow.goTo("prep")}>Practice Again</button>
      </div>
    );
  }
}
```

### Timer-Driven Sub-Mode Transitions

The Listen ↔ Speak cycle within the `work` step happens **inside** the step via field value changes — not via flow transitions. This is intentional: both sub-modes share the same step state (current question index, answers list, recording status).

```ts
// Controller logic (outside component or in useEffect)

function handleTimerExpire() {
  const work = store.proxy.speakingPractice.current;

  if (work.subMode.value === "listening") {
    // Listen time up → switch to speaking
    work.subMode.value = "speaking";
    work.isRecording.value = true;
    work.timerEndAt.value = Date.now() + work.speakDuration.value * 1000;
    audioRecorder.start();
  } else {
    // Speak time up → save answer and advance
    handleNextQuestion();
  }
}

async function handleStartAnswer() {
  const work = store.proxy.speakingPractice.current;
  work.subMode.value = "speaking";
  work.isRecording.value = true;
  work.timerEndAt.value = Date.now() + work.speakDuration.value * 1000;
  audioRecorder.start();
}

async function handleNextQuestion() {
  const work = store.proxy.speakingPractice.current;
  const recording = await audioRecorder.stop();
  work.isRecording.value = false;

  // Save answer
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
    // All questions done → flow.next() evaluates transition → moves to "result"
    await store.proxy.speakingPractice.next();
  } else {
    // More questions → cycle back to listening
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

### Why This Works Well with defineFlow

| Aspect | How defineFlow helps |
|--------|---------------------|
| **3-phase structure** | `prep → work → result` as explicit steps with typed transitions |
| **Async data loading** | `prep.resolve` loads session info; `work.questions.resolve` loads questions; `result.resolve` runs AI analysis |
| **Loading states** | `prep.loading`, `result.loading` — built-in, reactive, no boilerplate |
| **Timer sub-modes** | Within `work` step — just field value changes (`subMode`, `timerEndAt`), normal Palistor reactivity |
| **Answer collection** | `defineList` inside a flow step — `answers.add()`, iterate, count |
| **Auto-advance** | Transition fn checks `answers.length >= totalQuestions` — `flow.next()` evaluates and moves forward |
| **Retry / go back** | `flow.goTo("prep")` with `rollback: "keep-all"` — practice again with same session |
| **Persist** | Mid-session browser close? `usePersist` saves entire flow state including current question index and collected answers |
| **Analytics** | `onEnter` hooks on steps — track phase transitions without littering component code |

---

## Open Questions

- **Cycles in graph** — allow `step3 → step1`? If yes, history becomes a full path, not a stack. Probably should allow — quiz with retry is a real use case
- **Parallel branches** — `next()` returns array of steps? Or a separate `fork/join` primitive? Likely YAGNI initially
- **Persist** — with `rollback: "clear-abandoned"`, persisted data for the abandoned branch must also be cleared
- **Progress estimation** — for arbitrary DAG with conditional transitions, "how much is left" can only be estimated (min/max path length)
- **TypeScript inference** — `transitions` function should infer valid step names from `steps` keys; `flow.currentStep` should be a union of step name literals
