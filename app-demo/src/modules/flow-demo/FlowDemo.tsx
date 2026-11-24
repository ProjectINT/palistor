"use client";

import { useState } from "react";
import { useForm } from "@palistor";

import { flowStore, type OnboardingFlow } from "@/config/flow";
import { Badge } from "@/modules/shared";
import { StepIndicator } from "./StepIndicator";
import { AccountStep } from "./steps/AccountStep";
import { CompanyStep } from "./steps/CompanyStep";
import { PlanStep } from "./steps/PlanStep";
import { SummaryStep } from "./steps/SummaryStep";

type StepKey = OnboardingFlow["currentStepKey"];

// In the order of the flow's steps; keyed by the step keys, so none can be missing.
const STEPS: Record<StepKey, { label: string; title: string; description: string }> = {
  account: { label: "Account", title: "Create your account", description: "Tell us how to address you." },
  plan: { label: "Plan", title: "Choose a plan", description: "The plan determines the wizard's next steps." },
  company: { label: "Company", title: "Company details", description: "This step shows only for the Enterprise plan." },
  summary: { label: "Done", title: "Confirmation", description: "A final review before submitting." },
};
const STEP_KEYS = Object.keys(STEPS) as StepKey[];

/** The root of the tab: the only component that sees the store. */
export function FlowDemo() {
  const form = useForm(flowStore);
  // A successful flow.submit() leaves the flow on its last step: the finished state lives here.
  const [result, setResult] = useState<unknown>(null);

  const startOver = () => {
    setResult(null);
    form.onboarding.reset(); // first step again, values and history cleared
  };

  if (result) return <Done result={result} onStartOver={startOver} />;

  return (
    <div className="space-y-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Flow — a step-by-step wizard</h2>
          <Badge color="blue">defineFlow</Badge>
        </div>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          A single <code className="font-mono">defineFlow</code> assembles the steps into a group with navigation.
          Branching goes through <code className="font-mono">isVisible</code>: the <b>Enterprise</b> plan adds a
          &quot;Company&quot; step, while for the others <code className="font-mono">nextStep()</code> skips it.
        </p>
      </div>

      <Wizard flow={form.onboarding} onDone={setResult} />
    </div>
  );
}

function Wizard({ flow, onDone }: { flow: OnboardingFlow; onDone: (result: unknown) => void }) {
  const onboarding = useForm(flow);
  const key = onboarding.currentStepKey;
  const isLast = key === "summary";

  // Next submits the step: it validates, and the step's onSubmit calls nextStep().
  // The last step submits the whole flow instead.
  const next = async () => {
    if (!isLast) {
      await onboarding.steps.current.submit();
      return;
    }
    const submitted = await onboarding.submit();
    if (submitted.success) onDone(submitted.result);
  };

  // A step visited and then hidden keeps "completed": filter by isVisible.
  const indicator = STEP_KEYS.filter((stepKey) => onboarding.steps[stepKey].isVisible).map((stepKey) => ({
    key: stepKey,
    label: STEPS[stepKey].label,
    status: onboarding.steps[stepKey].status,
  }));

  return (
    <>
      <StepIndicator steps={indicator} />

      <div className="rounded-lg border border-zinc-100 p-5 dark:border-zinc-800">
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{STEPS[key].title}</h3>
        <p className="mb-4 text-xs text-zinc-400 dark:text-zinc-500">{STEPS[key].description}</p>

        {/* Handing a step down reads nothing of it; each step calls useForm on its own node. */}
        {key === "account" && <AccountStep step={onboarding.steps.account} />}
        {key === "plan" && <PlanStep step={onboarding.steps.plan} />}
        {key === "company" && <CompanyStep step={onboarding.steps.company} />}
        {key === "summary" && <SummaryStep flow={flow} />}
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          disabled={!onboarding.canGoBack}
          onClick={() => onboarding.back()}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          ← Back
        </button>
        {/* A second flow.submit() while one runs would call onSubmit again. */}
        <button
          type="button"
          disabled={onboarding.submitting}
          onClick={next}
          className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
        >
          {isLast ? (onboarding.submitting ? "Submitting…" : "Finish") : "Next →"}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-4 text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
        <span className="font-mono">flow.history:</span>
        {onboarding.history.map((stepKey, index) => (
          <span
            key={`${stepKey}-${index}`}
            className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
          >
            {stepKey}
          </span>
        ))}
      </div>
    </>
  );
}

function Done({ result, onStartOver }: { result: unknown; onStartOver: () => void }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-2xl dark:bg-green-900/50">
        ✓
      </div>
      <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Done!</h2>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        The flow is complete — <code className="font-mono">onSubmit</code> returned:
      </p>
      <pre className="mx-auto mt-4 max-w-md overflow-auto rounded-lg bg-zinc-50 p-3 text-left text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
        {JSON.stringify(result, null, 2)}
      </pre>
      <button
        type="button"
        onClick={onStartOver}
        className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
      >
        Start over
      </button>
    </div>
  );
}
