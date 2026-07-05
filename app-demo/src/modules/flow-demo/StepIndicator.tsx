"use client";

export interface StepMeta {
  key: string;
  label: string;
}

interface StepIndicatorProps {
  /** Visible steps in traversal order (those hidden by branching are excluded). */
  steps: StepMeta[];
  /** The flow proxy — reads every step's reactive `steps[key].status`. */
  flow: any;
}

const DOT_STYLES: Record<"active" | "completed" | "pending", string> = {
  active: "bg-blue-600 text-white ring-4 ring-blue-100 dark:ring-blue-900/40",
  completed: "bg-green-600 text-white",
  pending: "bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400",
};

const LABEL_STYLES: Record<"active" | "completed" | "pending", string> = {
  active: "text-blue-600 dark:text-blue-400 font-medium",
  completed: "text-green-600 dark:text-green-400",
  pending: "text-zinc-400 dark:text-zinc-500",
};

export function StepIndicator({ steps, flow }: StepIndicatorProps) {
  return (
    <ol className="flex items-center gap-2">
      {steps.map((meta, index) => {
        // status is a computed step-proxy property: "active" | "completed" | null.
        const status: "active" | "completed" | null = flow.steps[meta.key].status;
        const state = status ?? "pending";

        return (
          <li
            key={meta.key}
            className="flex items-center gap-2"
          >
            <div className="flex flex-col items-center gap-1">
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors ${DOT_STYLES[state]}`}
              >
                {status === "completed" ? "✓" : index + 1}
              </span>
              <span className={`text-xs whitespace-nowrap ${LABEL_STYLES[state]}`}>
                {meta.label}
              </span>
            </div>
            {index < steps.length - 1 && (
              <span className="mb-5 h-px w-8 flex-1 bg-zinc-200 dark:bg-zinc-700" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
