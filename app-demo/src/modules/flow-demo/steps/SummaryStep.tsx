"use client";

import { useForm } from "@palistor";

import type { OnboardingFlow } from "@/config/flow";
import { PLAN_OPTIONS } from "../plans";

/**
 * A field-less step: it shows `flow.values` (every step by key) and, after a
 * failed Finish, `flow.errors`. The company rows follow the step's isVisible,
 * not a copy of its rule.
 */
export function SummaryStep({ flow }: { flow: OnboardingFlow }) {
  const onboarding = useForm(flow);
  const { account, plan, company } = onboarding.values;

  const rows = [
    { label: "Full name", value: account.fullName },
    { label: "Email", value: account.email },
    { label: "Plan", value: PLAN_OPTIONS.find((option) => option.value === plan.plan)?.name },
    ...(onboarding.steps.company.isVisible
      ? [
          { label: "Company", value: company.companyName },
          { label: "Team size", value: company.teamSize },
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">Review your details and finish the registration.</p>

      <dl className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-700">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between px-4 py-2.5">
            <dt className="text-sm text-zinc-500 dark:text-zinc-400">{row.label}</dt>
            <dd className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{row.value || "—"}</dd>
          </div>
        ))}
      </dl>

      {onboarding.errors.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900/50 dark:bg-red-950/40">
          <p className="mb-1 text-xs font-medium text-red-700 dark:text-red-300">Could not finish — check these steps:</p>
          <ul className="list-disc pl-4 text-xs text-red-600 dark:text-red-400">
            {onboarding.errors.map((error) => (
              <li key={error.path}>
                <span className="font-mono">{error.path}</span>: {error.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
