"use client";

import { PLAN_OPTIONS } from "@/config/flow";

/**
 * Шаг 2 — выбор плана. Клик по карточке пишет `step.plan.value`. Выбор
 * `enterprise` включает (через `isVisible`) шаг «Компания» — иначе `nextStep()`
 * его пропускает. Ошибка обязательности читается из `step.plan.errorMessage`.
 */
export function PlanStep({ step }: { step: any }) {
  const selected: string = step.plan.value;
  const errorMessage: string | undefined = step.plan.errorMessage;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {PLAN_OPTIONS.map((plan) => {
          const isActive = selected === plan.value;
          return (
            <button
              key={plan.value}
              type="button"
              onClick={() => {
                step.plan.value = plan.value;
              }}
              className={`flex flex-col gap-1 rounded-xl border p-4 text-left transition-colors ${
                isActive
                  ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500 dark:bg-blue-950/40"
                  : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600"
              }`}
            >
              <span className="flex items-center justify-between">
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {plan.name}
                </span>
                {plan.value === "enterprise" && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
                    +1 шаг
                  </span>
                )}
              </span>
              <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
                {plan.price}
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {plan.description}
              </span>
            </button>
          );
        })}
      </div>
      {errorMessage && (
        <p className="text-xs text-danger">{errorMessage}</p>
      )}
    </div>
  );
}
