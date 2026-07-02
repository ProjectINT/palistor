/**
 * Демо `defineFlow` — пошаговый мастер (wizard) на step-flow примитиве Palistor.
 *
 * `defineFlow` собирает из массива `defineStep(...)` обычную группу конфига, где
 * каждый шаг — дочерняя группа по своему ключу. NodeRegistry по маркеру создаёт
 * навигационное состояние (текущий шаг, стек посещений, статусы), а flow-proxy
 * даёт реактивные `currentStepKey` / `canGoBack` / `steps` / `values` / `errors`
 * и методы `nextStep()` / `back()` / `goTo()` / `submit()`.
 *
 * Что демонстрирует пример:
 *  - линейную навигацию (`nextStep` / `back`) с валидацией на каждом шаге;
 *  - ветвление через `isVisible` — шаг «Company» существует во флоу только для
 *    плана Enterprise, `nextStep()` его пропускает для остальных;
 *  - навигацию из `onSubmit` шага (3-й аргумент — flow-proxy: `{ nextStep }`);
 *  - агрегированные `flow.values` (все шаги по ключам) и финализацию `flow.submit()`.
 */

import { defineFlow, defineStep } from "@palistor";
import { Palistor } from "@palistor/store/store";
import { useForm } from "@palistor/react/useForm";

// ============================================================================
// Опции плана — используются и в конфиге (валидация), и в UI (карточки выбора)
// ============================================================================

export type PlanId = "free" | "pro" | "enterprise";

export interface PlanOption {
  value: PlanId;
  name: string;
  price: string;
  description: string;
}

export const PLAN_OPTIONS: PlanOption[] = [
  { value: "free", name: "Free", price: "$0", description: "Для личных проектов" },
  { value: "pro", name: "Pro", price: "$29 / мес", description: "Для растущих команд" },
  {
    value: "enterprise",
    name: "Enterprise",
    price: "Custom",
    description: "SSO, аудит, выделенная поддержка",
  },
];

export const TEAM_SIZE_OPTIONS = [
  { value: "1-10", label: "1–10 человек" },
  { value: "11-50", label: "11–50 человек" },
  { value: "51-200", label: "51–200 человек" },
  { value: "200+", label: "200+ человек" },
];

// ============================================================================
// Flow-нода — упорядоченный массив шагов
// ============================================================================

/**
 * Значения флоу, аккумулируемые по всем шагам (в т.ч. скрытым). Именно этот
 * объект приходит в `isVisible` шага (`values.plan.plan`), в `flow.values` и
 * во flow-level `onSubmit`.
 */
export interface OnboardingValues {
  account: { fullName: string; email: string };
  plan: { plan: PlanId | "" };
  company: { companyName: string; teamSize: string };
  summary: Record<string, never>;
}

export const onboardingFlow = defineFlow({
  steps: [
    // ── Шаг 1: аккаунт ─────────────────────────────────────────────────────
    defineStep("account", {
      fullName: {
        value: "",
        label: "Имя и фамилия",
        placeholder: "Ада Лавлейс",
        isRequired: true,
        validate: (v: string) =>
          v.trim().length < 2 ? "Введите минимум 2 символа" : undefined,
      },
      email: {
        value: "",
        label: "Рабочий email",
        placeholder: "you@company.com",
        isRequired: true,
        validate: (v: string) => (!v.includes("@") ? "Введите корректный email" : undefined),
      },
      // 3-й аргумент onSubmit — flow-proxy; деструктуризация { nextStep } работает,
      // т.к. навигационные методы — bound-замыкания.
      onSubmit: (_values: any, _store: any, { nextStep }: { nextStep: () => void }) => {
        nextStep();
      },
    }),

    // ── Шаг 2: выбор плана ────────────────────────────────────────────────
    defineStep("plan", {
      plan: {
        value: "" as PlanId | "",
        isRequired: true,
        validate: (v: string) => (!v ? "Выберите план, чтобы продолжить" : undefined),
      },
      onSubmit: (_values: any, _store: any, { nextStep }: { nextStep: () => void }) => {
        nextStep();
      },
    }),

    // ── Шаг 3: данные компании — ТОЛЬКО для Enterprise ────────────────────
    // Ветвление через isVisible: nextStep() пропускает скрытый шаг. Для Free/Pro
    // мастер идёт account → plan → summary, минуя этот шаг. Значения скрытого шага
    // сохраняются в flow.values, но исключаются из валидации при финализации.
    defineStep("company", {
      companyName: {
        value: "",
        label: "Название компании",
        placeholder: "Acme Inc.",
        isRequired: true,
      },
      teamSize: {
        value: "1-10",
        label: "Размер команды",
      },
      isVisible: (values: OnboardingValues) => values.plan.plan === "enterprise",
      onSubmit: (_values: any, _store: any, { nextStep }: { nextStep: () => void }) => {
        nextStep();
      },
    }),

    // ── Шаг 4: сводка (read-only) — финализация через flow.submit() ───────
    defineStep("summary", {}),
  ],

  /**
   * Flow-level submit: вызывается стандартным submit-пайплайном над всеми шагами
   * (валидируются только видимые). Здесь — имитация запроса к API.
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
 * Хук подключения к flowStore. `form.onboarding` — flow-proxy.
 *
 * @example
 * const form = useFlowForm();
 * const flow = form.onboarding;
 * flow.currentStepKey;         // "account" — реактивно
 * flow.steps.account.email;    // field-proxy (спредится в компонент)
 * flow.nextStep();             // следующий видимый шаг
 */
export const useFlowForm = () => useForm(flowStore) as any;
