/**
 * `defineFlow` demo — a step-by-step wizard on Palistor's step-flow primitive.
 *
 * `defineFlow` assembles an ordinary config group out of a `defineStep(...)`
 * array, where every step is a child group under its key. NodeRegistry uses
 * the marker to create the navigation state (current step, visit stack,
 * statuses), and the flow proxy exposes the reactive `currentStepKey` /
 * `canGoBack` / `steps` / `values` / `errors` plus the `nextStep()` /
 * `back()` / `goTo()` / `submit()` methods.
 *
 * What this example demonstrates:
 *  - linear navigation (`nextStep` / `back`) with per-step validation;
 *  - branching via `isVisible` — the "Company" step exists in the flow only
 *    for the Enterprise plan; `nextStep()` skips it for the rest;
 *  - navigation from a step's `onSubmit` (the 3rd argument is the flow proxy:
 *    `{ nextStep }`);
 *  - the aggregated `flow.values` (all steps by key) and `flow.submit()` finalization.
 */

import { defineFlow, defineStep } from "@palistor";
import { Palistor } from "@palistor/store/store";
import { useForm } from "@palistor/react/useForm";

// ============================================================================
// Plan options — used both in the config (validation) and in the UI (cards)
// ============================================================================

export type PlanId = "free" | "pro" | "enterprise";

export interface PlanOption {
  value: PlanId;
  name: string;
  price: string;
  description: string;
}

export const PLAN_OPTIONS: PlanOption[] = [
  { value: "free", name: "Free", price: "$0", description: "For personal projects" },
  { value: "pro", name: "Pro", price: "$29 / mo", description: "For growing teams" },
  {
    value: "enterprise",
    name: "Enterprise",
    price: "Custom",
    description: "SSO, audit logs, dedicated support",
  },
];

export const TEAM_SIZE_OPTIONS = [
  { value: "1-10", label: "1–10 people" },
  { value: "11-50", label: "11–50 people" },
  { value: "51-200", label: "51–200 people" },
  { value: "200+", label: "200+ people" },
];

// ============================================================================
// The flow node — an ordered array of steps
// ============================================================================

/**
 * Flow values accumulated across all steps (including hidden ones). This is
 * the object passed to a step's `isVisible` (`values.plan.plan`), exposed as
 * `flow.values`, and handed to the flow-level `onSubmit`.
 */
export interface OnboardingValues {
  account: { fullName: string; email: string };
  plan: { plan: PlanId | "" };
  company: { companyName: string; teamSize: string };
  summary: Record<string, never>;
}

export const onboardingFlow = defineFlow({
  steps: [
    // ── Step 1: account ────────────────────────────────────────────────────
    defineStep("account", {
      fullName: {
        value: "",
        label: "Full name",
        placeholder: "Ada Lovelace",
        isRequired: true,
        validate: (v: string) =>
          v.trim().length < 2 ? "Enter at least 2 characters" : undefined,
      },
      email: {
        value: "",
        label: "Work email",
        placeholder: "you@company.com",
        isRequired: true,
        validate: (v: string) => (!v.includes("@") ? "Enter a valid email" : undefined),
      },
      // The 3rd onSubmit argument is the flow proxy; destructuring { nextStep }
      // works because the navigation methods are bound closures.
      onSubmit: (_values: any, _store: any, { nextStep }: { nextStep: () => void }) => {
        nextStep();
      },
    }),

    // ── Step 2: plan selection ────────────────────────────────────────────
    defineStep("plan", {
      plan: {
        value: "" as PlanId | "",
        isRequired: true,
        validate: (v: string) => (!v ? "Pick a plan to continue" : undefined),
      },
      onSubmit: (_values: any, _store: any, { nextStep }: { nextStep: () => void }) => {
        nextStep();
      },
    }),

    // ── Step 3: company details — Enterprise ONLY ──────────────────────────
    // Branching via isVisible: nextStep() skips the hidden step. For Free/Pro
    // the wizard goes account → plan → summary, bypassing this step. The
    // hidden step's values stay in flow.values but are excluded from
    // validation at finalization.
    defineStep("company", {
      companyName: {
        value: "",
        label: "Company name",
        placeholder: "Acme Inc.",
        isRequired: true,
      },
      teamSize: {
        value: "1-10",
        label: "Team size",
      },
      isVisible: (values: OnboardingValues) => values.plan.plan === "enterprise",
      onSubmit: (_values: any, _store: any, { nextStep }: { nextStep: () => void }) => {
        nextStep();
      },
    }),

    // ── Step 4: summary (read-only) — finalized via flow.submit() ─────────
    defineStep("summary", {}),
  ],

  /**
   * Flow-level submit: invoked by the standard submit pipeline over all
   * steps (only visible ones are validated). Here — a mock API request.
   */
  onSubmit: async (values) => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    return { ok: true, values: values as OnboardingValues };
  },
});

// ============================================================================
// Store
// ============================================================================

export const flowConfig = {
  onboarding: onboardingFlow,
};

export const flowStore = new Palistor({ config: flowConfig });

/**
 * Hook connecting to the flowStore. `form.onboarding` is the flow proxy.
 *
 * @example
 * const form = useFlowForm();
 * const flow = form.onboarding;
 * flow.currentStepKey;         // "account" — reactive
 * flow.steps.account.email;    // field proxy (spreads into a component)
 * flow.nextStep();             // the next visible step
 */
export const useFlowForm = () => useForm(flowStore) as any;
