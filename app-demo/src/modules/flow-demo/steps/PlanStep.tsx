"use client";

import { useForm } from "@palistor";
import type { FieldProxyNode, PalistorProxy } from "@palistor";

import type { PlanId, PlanValues } from "@/config/flow";
import { PLAN_OPTIONS } from "../plans";

export function PlanStep({ step }: { step: PalistorProxy<PlanValues> }) {
  return <PlanCards field={useForm(step).plan} />;
}

/**
 * The plan field as a row of cards. Picking Enterprise makes the "company"
 * step visible (its isVisible in config/flow.ts); the indicator follows.
 */
function PlanCards({ field }: { field: FieldProxyNode<PlanId | ""> }) {
  const plan = useForm(field);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {PLAN_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={plan.value === option.value}
            onClick={() => plan.onValueChange(option.value)}
            className={`flex flex-col gap-1 rounded-xl border p-4 text-left transition-colors ${
              plan.value === option.value
                ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500 dark:bg-blue-950/40"
                : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600"
            }`}
          >
            <span className="flex items-center justify-between">
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">{option.name}</span>
              {option.value === "enterprise" && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
                  +1 step
                </span>
              )}
            </span>
            <span className="text-sm font-medium text-blue-600 dark:text-blue-400">{option.price}</span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{option.description}</span>
          </button>
        ))}
      </div>
      {plan.isInvalid && <p className="text-xs text-danger">{plan.errorMessage}</p>}
    </div>
  );
}
