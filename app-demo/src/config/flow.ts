/**
 * The "Flow Wizard" tab: an onboarding wizard built with defineFlow.
 *
 * - Next submits the current step: the step validates, and its onSubmit moves on.
 * - Branching: the "company" step is visible only for the Enterprise plan, so
 *   nextStep() skips it for the others and the final submit does not validate it.
 * - The flow's onSubmit gets the values of every step and sends only the branch taken.
 */

import { Palistor, defineFlow, defineStep } from "@palistor";
import type { ConfigProxy } from "@palistor";

export type PlanId = "free" | "pro" | "enterprise";
export type TeamSize = "1-10" | "11-50" | "51-200" | "200+";

// The values of each step, to type the step components (`PalistorProxy<AccountValues>`).
export interface AccountValues {
  fullName: string;
  email: string;
}
export interface PlanValues {
  plan: PlanId | "";
}
export interface CompanyValues {
  companyName: string;
  teamSize: TeamSize;
}

// A step's onSubmit runs only when the step is valid; its third argument is the flow.
const advance = (_values: unknown, _store: unknown, flow: { nextStep(): void }) => flow.nextStep();

const flowConfig = {
  onboarding: defineFlow({
    steps: [
      // defineStep infers literal types: widen every default with `as`.
      defineStep("account", {
        fullName: {
          value: "" as string,
          label: "Full name",
          placeholder: "Ada Lovelace",
          isRequired: true,
          validate: (value: string) => (value.trim().length < 2 ? "Enter at least 2 characters" : undefined),
        },
        email: {
          value: "" as string,
          label: "Work email",
          placeholder: "you@company.com",
          isRequired: true,
          validate: (value: string) => (value.includes("@") ? undefined : "Enter a valid email"),
        },
        onSubmit: advance,
      }),

      defineStep("plan", {
        plan: {
          value: "" as PlanId | "",
          isRequired: true,
          validate: (value: PlanId | "") => (value ? undefined : "Pick a plan to continue"),
        },
        onSubmit: advance,
      }),

      defineStep("company", {
        // A step's isVisible receives the flow's values, keyed by step.
        isVisible: (values: { plan: PlanValues }) => values.plan.plan === "enterprise",
        companyName: {
          value: "" as string,
          label: "Company name",
          placeholder: "Acme Inc.",
          isRequired: true,
          validate: (value: string) => (value.trim() ? undefined : "Enter the company name"),
        },
        teamSize: { value: "1-10" as TeamSize, label: "Team size" },
        onSubmit: advance,
      }),

      // Field-less: the Finish button calls flow.submit() here.
      defineStep("summary", {}),
    ],

    // The values of a step the user left by switching plans are still here:
    // build the payload from the branch taken.
    onSubmit: async ({ account, plan, company }) => {
      const payload = { ...account, plan: plan.plan, ...(plan.plan === "enterprise" ? company : {}) };
      await new Promise((resolve) => setTimeout(resolve, 700)); // a mock request
      return { ok: true, payload };
    },
  }),
};

export const flowStore = new Palistor({ config: flowConfig });

/** The flow node, to type the components it is handed to. */
export type OnboardingFlow = ConfigProxy<typeof flowConfig>["onboarding"];
