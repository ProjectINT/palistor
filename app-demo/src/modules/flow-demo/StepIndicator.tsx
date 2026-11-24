import type { StepStatus } from "@palistor";

export interface IndicatorStep {
  key: string;
  label: string;
  /** "active" | "completed" (visited and left) | null (not visited yet). */
  status: StepStatus;
}

type Dot = "active" | "completed" | "pending";

const DOT_CLASS: Record<Dot, string> = {
  active: "bg-blue-600 text-white ring-4 ring-blue-100 dark:ring-blue-900/40",
  completed: "bg-green-600 text-white",
  pending: "bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400",
};

const LABEL_CLASS: Record<Dot, string> = {
  active: "text-blue-600 dark:text-blue-400 font-medium",
  completed: "text-green-600 dark:text-green-400",
  pending: "text-zinc-400 dark:text-zinc-500",
};

/** The visible steps in order, each with its status. Knows nothing about the store. */
export function StepIndicator({ steps }: { steps: IndicatorStep[] }) {
  return (
    <ol className="flex items-center gap-2">
      {steps.map((step, index) => {
        const dot: Dot = step.status ?? "pending";
        return (
          <li key={step.key} className="flex items-center gap-2">
            <div className="flex flex-col items-center gap-1">
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors ${DOT_CLASS[dot]}`}
              >
                {step.status === "completed" ? "✓" : index + 1}
              </span>
              <span className={`text-xs whitespace-nowrap ${LABEL_CLASS[dot]}`}>{step.label}</span>
            </div>
            {index < steps.length - 1 && <span className="mb-5 h-px w-8 flex-1 bg-zinc-200 dark:bg-zinc-700" />}
          </li>
        );
      })}
    </ol>
  );
}
