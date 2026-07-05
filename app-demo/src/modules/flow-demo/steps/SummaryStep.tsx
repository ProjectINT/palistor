"use client";

import { PLAN_OPTIONS } from "@/config/flow";

interface Row {
  label: string;
  value: string;
}

/**
 * Step 4 — the summary (read-only). Reads the aggregated `flow.values` (all
 * steps by key) and the reactive `flow.errors`. Finalization happens via the
 * "Finish" button in the container (a `flow.submit()` call).
 */
export function SummaryStep({ flow }: { flow: any }) {
  const values = flow.values;
  const planName =
    PLAN_OPTIONS.find((p) => p.value === values.plan.plan)?.name ?? "—";
  const isEnterprise = values.plan.plan === "enterprise";

  const rows: Row[] = [
    { label: "Full name", value: values.account.fullName || "—" },
    { label: "Email", value: values.account.email || "—" },
    { label: "Plan", value: planName },
  ];
  if (isEnterprise) {
    rows.push(
      { label: "Company", value: values.company.companyName || "—" },
      { label: "Team size", value: values.company.teamSize },
    );
  }

  const errors: Array<{ path: string; message: string }> = flow.errors;

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Review your details and finish the registration.
      </p>

      <dl className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-700">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between px-4 py-2.5"
          >
            <dt className="text-sm text-zinc-500 dark:text-zinc-400">{row.label}</dt>
            <dd className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      {errors.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900/50 dark:bg-red-950/40">
          <p className="mb-1 text-xs font-medium text-red-700 dark:text-red-300">
            Could not finish — check these steps:
          </p>
          <ul className="list-disc pl-4 text-xs text-red-600 dark:text-red-400">
            {errors.map((err) => (
              <li key={err.path}>
                <span className="font-mono">{err.path}</span>: {err.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
