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
  /** Шаг существует во флоу только для плана Enterprise (ветвление isVisible). */
  enterpriseOnly?: boolean;
}

const STEPS: StepDef[] = [
  {
    key: "account",
    label: "Аккаунт",
    title: "Создание аккаунта",
    description: "Расскажите, как к вам обращаться.",
  },
  {
    key: "plan",
    label: "План",
    title: "Выбор плана",
    description: "План определяет дальнейшие шаги мастера.",
  },
  {
    key: "company",
    label: "Компания",
    title: "Данные компании",
    description: "Этот шаг показывается только для плана Enterprise.",
    enterpriseOnly: true,
  },
  {
    key: "summary",
    label: "Готово",
    title: "Подтверждение",
    description: "Финальная проверка перед отправкой.",
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

  // Индикатор показывает только видимые шаги — скрытая ветка не мозолит глаза.
  const visibleSteps = STEPS.filter((s) => !s.enterpriseOnly || isEnterprise);
  const active = STEPS.find((s) => s.key === currentKey)!;

  const handleContinue = async () => {
    if (isSummary) {
      // Финализация: стандартный submit-пайплайн над всеми (видимыми) шагами.
      setSubmitting(true);
      const result = await flow.submit();
      setSubmitting(false);
      if (result.success) setDone(result.result);
      return;
    }
    // Не последний шаг: submit шага валидирует его; при успехе onSubmit шага
    // сам двигает навигацию (nextStep) — 3-й аргумент onSubmit это flow-proxy.
    await flow.steps.current.submit();
  };

  const handleStartOver = () => {
    setDone(null);
    flow.reset();
  };

  // ── Терминальный экран после успешной финализации ────────────────────────
  if (done) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-2xl dark:bg-green-900/50">
          ✓
        </div>
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
          Готово!
        </h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Флоу завершён — <code className="font-mono">onSubmit</code> вернул результат:
        </p>
        <pre className="mx-auto mt-4 max-w-md overflow-auto rounded-lg bg-zinc-50 p-3 text-left text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
          {JSON.stringify(done, null, 2)}
        </pre>
        <button
          type="button"
          onClick={handleStartOver}
          className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          Начать заново
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      {/* Заголовок демо */}
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            Flow — пошаговый мастер
          </h2>
          <Badge color="blue">defineFlow</Badge>
        </div>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Один <code className="font-mono">defineFlow</code> собирает шаги в группу с
          навигацией. Ветвление — через <code className="font-mono">isVisible</code>:
          план <b>Enterprise</b> добавляет шаг «Компания», для остальных{" "}
          <code className="font-mono">nextStep()</code> его пропускает.
        </p>
      </div>

      {/* Индикатор шагов */}
      <StepIndicator
        steps={visibleSteps}
        flow={flow}
      />

      {/* Активный шаг */}
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

      {/* Навигация */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          disabled={!flow.canGoBack}
          onClick={() => flow.back()}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          ← Назад
        </button>

        <button
          type="button"
          disabled={submitting}
          onClick={handleContinue}
          className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
        >
          {isSummary ? (submitting ? "Отправка…" : "Завершить") : "Далее →"}
        </button>
      </div>

      {/* Живой инспектор навигации */}
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
