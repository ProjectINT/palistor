"use client";

import { useState } from "react";

import { useFlowForm } from "@/config/flow";
import { Badge } from "@/modules/shared";
import { StepIndicator, type StepMeta } from "./StepIndicator";
import { AccountStep } from "./steps/AccountStep";
import { PlanStep } from "./steps/PlanStep";
import { CompanyStep } from "./steps/CompanyStep";
import { SummaryStep } from "./steps/SummaryStep";

interface StepDef extends StepMeta {
  title: string;
  description: string;
  /** The step exists in the flow only for the Enterprise plan (isVisible branching). */
  enterpriseOnly?: boolean;
}

const STEPS: StepDef[] = [
  {
    key: "account",
    label: "Account",
    title: "Create your account",
    description: "Tell us how to address you.",
  },
  {
    key: "plan",
    label: "Plan",
    title: "Choose a plan",
    description: "The plan determines the wizard's next steps.",
  },
  {
    key: "company",
    label: "Company",
    title: "Company details",
    description: "This step shows only for the Enterprise plan.",
    enterpriseOnly: true,
  },
  {
    key: "summary",
    label: "Done",
    title: "Confirmation",
    description: "A final review before submitting.",
  },
];

export function FlowDemo() {
  const form = useFlowForm();
  const flow = form.onboarding;

  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<unknown>(null);

  const currentKey: string = flow.currentStepKey;
  const isEnterprise = flow.values.plan.plan === "enterprise";
  const isSummary = currentKey === "summary";

  // The indicator shows only visible steps — the hidden branch stays out of sight.
  const visibleSteps = STEPS.filter((s) => !s.enterpriseOnly || isEnterprise);
  const active = STEPS.find((s) => s.key === currentKey)!;

  const handleContinue = async () => {
    if (isSummary) {
      // Finalization: the standard submit pipeline over all (visible) steps.
      setSubmitting(true);
      const result = await flow.submit();
      setSubmitting(false);
      if (result.success) setDone(result.result);
      return;
    }
    // Not the last step: the step's submit validates it; on success the step's
    // onSubmit drives navigation itself (nextStep) — onSubmit's 3rd argument is the flow proxy.
    await flow.steps.current.submit();
  };

  const handleStartOver = () => {
    setDone(null);
    flow.reset();
  };

  // ── Terminal screen after successful finalization ────────────────────────
  if (done) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-2xl dark:bg-green-900/50">
          ✓
        </div>
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
          Done!
        </h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          The flow is complete — <code className="font-mono">onSubmit</code> returned:
        </p>
        <pre className="mx-auto mt-4 max-w-md overflow-auto rounded-lg bg-zinc-50 p-3 text-left text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
          {JSON.stringify(done, null, 2)}
        </pre>
        <button
          type="button"
          onClick={handleStartOver}
          className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          Start over
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      {/* Demo header */}
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            Flow — a step-by-step wizard
          </h2>
          <Badge color="blue">defineFlow</Badge>
        </div>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          A single <code className="font-mono">defineFlow</code> assembles the steps into a
          group with navigation. Branching goes through <code className="font-mono">isVisible</code>:
          the <b>Enterprise</b> plan adds a "Company" step, while for the others{" "}
          <code className="font-mono">nextStep()</code> skips it.
        </p>
      </div>

      {/* Step indicator */}
      <StepIndicator
        steps={visibleSteps}
        flow={flow}
      />

      {/* Active step */}
      <div className="rounded-lg border border-zinc-100 p-5 dark:border-zinc-800">
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {active.title}
        </h3>
        <p className="mb-4 text-xs text-zinc-400 dark:text-zinc-500">
          {active.description}
        </p>

        {currentKey === "account" && <AccountStep step={flow.steps.account} />}
        {currentKey === "plan" && <PlanStep step={flow.steps.plan} />}
        {currentKey === "company" && <CompanyStep step={flow.steps.company} />}
        {currentKey === "summary" && <SummaryStep flow={flow} />}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          disabled={!flow.canGoBack}
          onClick={() => flow.back()}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          ← Back
        </button>

        <button
          type="button"
          disabled={submitting}
          onClick={handleContinue}
          className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
        >
          {isSummary ? (submitting ? "Submitting…" : "Finish") : "Next →"}
        </button>
      </div>

      {/* Live navigation inspector */}
      <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-4 text-xs text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
        <span className="font-mono">flow.history:</span>
        {flow.history.map((key: string, i: number) => (
          <span
            key={`${key}-${i}`}
            className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
          >
            {key}
          </span>
        ))}
      </div>
    </div>
  );
}
