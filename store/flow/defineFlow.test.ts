/**
 * Тесты для defineFlow / defineStep — структура конфига и регистрация.
 *
 * Покрывает:
 *  1. defineStep — структура результата + валидация (status зарезервирован, leaf запрещён)
 *  2. defineFlow — сборка flow-ноды (шаги-группы + __flowSteps), валидация ключей
 *  3. Регистрация в Palistor: FlowState, stepToFlow, values / getValues
 *  4. Прокси: state-ключи флоу, steps-доступ (индекс / ключ / current / length)
 *  5. Статус шага: производный от навигации, не попадает в values
 *  6. Spread flow-proxy: ключи группы + флоу, без internal-ключей
 */
import { describe, it, expect, vi } from "vitest";
import { defineFlow, defineStep } from "./defineFlow";
import { FLOW_STEPS_PROP } from "../constants";
import { Palistor } from "../store";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeOnboardingConfig() {
  return {
    promoCode: { value: "" },
    onboarding: defineFlow({
      steps: [
        defineStep("welcome", {
          name: { value: "", isRequired: true },
          age: { value: 0 },
        }),
        defineStep("goal", {
          goal: { value: "" },
        }),
        defineStep("summary", {}),
      ],
      onSubmit: vi.fn(async () => undefined),
    }),
  };
}

// ─── 1. defineStep — структура ────────────────────────────────────────────────

describe("defineStep — структура результата", () => {
  it("возвращает { key, config } с тем же конфигом", () => {
    const config = { name: { value: "" } };
    const step = defineStep("welcome", config);
    expect(step.key).toBe("welcome");
    expect(step.config).toBe(config);
  });

  it("бросает при зарезервированном поле status в конфиге шага", () => {
    expect(() => defineStep("s", { status: { value: "" } } as any)).toThrow(/reserved/);
  });

  it("бросает, если конфиг шага — leaf (есть value)", () => {
    expect(() => defineStep("s", { value: "" } as any)).toThrow(/group node/);
  });

  it("бросает при пустом ключе", () => {
    expect(() => defineStep("" as string, {})).toThrow(/non-empty/);
  });
});

// ─── 2. defineFlow — сборка ноды ─────────────────────────────────────────────

describe("defineFlow — структура результата", () => {
  it("шаги становятся дочерними группами по своим ключам, порядок в __flowSteps", () => {
    const welcome = { name: { value: "" } };
    const summary = {};
    const flow = defineFlow({
      steps: [defineStep("welcome", welcome), defineStep("summary", summary)],
    }) as any;

    expect(flow.welcome).toBe(welcome);
    expect(flow.summary).toBe(summary);
    expect(flow[FLOW_STEPS_PROP]).toEqual(["welcome", "summary"]);
  });

  it("onSubmit / beforeSubmit / afterSubmit переносятся на flow-ноду", () => {
    const onSubmit = vi.fn();
    const afterSubmit = vi.fn();
    const flow = defineFlow({
      steps: [defineStep("a", {})],
      onSubmit,
      afterSubmit,
    }) as any;
    expect(flow.onSubmit).toBe(onSubmit);
    expect(flow.afterSubmit).toBe(afterSubmit);
  });

  it("бросает при пустом массиве шагов", () => {
    expect(() => defineFlow({ steps: [] as any })).toThrow(/non-empty/);
  });

  it("бросает при дубликате ключа шага", () => {
    expect(() =>
      defineFlow({ steps: [defineStep("a", {}), defineStep("a", {})] as any }),
    ).toThrow(/duplicate/);
  });

  it("бросает при зарезервированном ключе шага (values, steps, current, …)", () => {
    for (const key of ["values", "steps", "current", "submit", "value"]) {
      expect(() => defineFlow({ steps: [defineStep(key, {})] as any })).toThrow(/reserved/);
    }
  });
});

// ─── 3. Регистрация в Palistor ────────────────────────────────────────────────

describe("defineFlow — регистрация в store", () => {
  it("FlowState создаётся, шаги проиндексированы в stepToFlow", () => {
    const store = new Palistor({ config: makeOnboardingConfig() as any });

    expect(store.nodes.allFlowStates.length).toBe(1);
    const fs = store.nodes.allFlowStates[0];
    expect(fs.stepKeys).toEqual(["welcome", "goal", "summary"]);
    expect(fs.currentIndex).toBe(0);
    expect(fs.visitStack).toEqual([]);
    expect(fs.path).toBe("onboarding");
    for (const stepNode of fs.stepNodes) {
      expect(store.nodes.stepToFlow.get(stepNode as object)).toBe(fs);
    }
  });

  it("values флоу — все шаги по ключам; __flowSteps не протекает", () => {
    const store = new Palistor({ config: makeOnboardingConfig() as any });
    const values = store.getValues() as any;

    expect(values.onboarding).toEqual({
      welcome: { name: "", age: 0 },
      goal: { goal: "" },
      summary: {},
    });
    expect(FLOW_STEPS_PROP in values.onboarding).toBe(false);

    const proxy = store.proxy as any;
    expect(proxy.onboarding.values).toEqual(values.onboarding);
  });

  it("initialValues применяются к полям шагов", () => {
    const store = new Palistor({
      config: makeOnboardingConfig() as any,
      initialValues: { onboarding: { welcome: { name: "Alice" } } } as any,
    });
    expect((store.proxy as any).onboarding.steps.welcome.name.value).toBe("Alice");
  });

  it("вложенный флоу (внутри группы) тоже регистрируется", () => {
    const store = new Palistor({
      config: {
        section: {
          wizard: defineFlow({ steps: [defineStep("one", {}), defineStep("two", {})] }),
        },
      } as any,
    });
    expect(store.nodes.allFlowStates.length).toBe(1);
    expect(store.nodes.allFlowStates[0].path).toBe("section.wizard");
  });
});

// ─── 4. Прокси: состояние флоу и steps ───────────────────────────────────────

describe("defineFlow — flow proxy", () => {
  it("начальное состояние: первый шаг активен, canGoBack=false, history=[first]", () => {
    const store = new Palistor({ config: makeOnboardingConfig() as any });
    const flow = (store.proxy as any).onboarding;

    expect(flow.currentStepKey).toBe("welcome");
    expect(flow.currentStepIndex).toBe(0);
    expect(flow.canGoBack).toBe(false);
    expect(flow.history).toEqual(["welcome"]);
    expect(flow.errors).toEqual([]);
  });

  it("steps: доступ по индексу, ключу, current и length; ссылки стабильны", () => {
    const store = new Palistor({ config: makeOnboardingConfig() as any });
    const flow = (store.proxy as any).onboarding;

    expect(flow.steps.length).toBe(3);
    expect(flow.steps[0]).toBe(flow.steps.welcome);
    expect(flow.steps[1]).toBe(flow.steps.goal);
    expect(flow.steps.current).toBe(flow.steps.welcome);
    expect(flow.steps).toBe(flow.steps); // кэш steps-proxy
    expect([...flow.steps].length).toBe(3); // итерация
  });

  it("поля шага доступны и пишутся через step proxy", () => {
    const store = new Palistor({ config: makeOnboardingConfig() as any });
    const flow = (store.proxy as any).onboarding;

    flow.steps.welcome.name.value = "Bob";
    expect(flow.steps.welcome.name.value).toBe("Bob");
    expect(flow.values.welcome.name).toBe("Bob");
    expect(flow.dirty).toBe(true);
  });

  it("status: первый шаг active, остальные null; status не попадает в values", () => {
    const store = new Palistor({ config: makeOnboardingConfig() as any });
    const flow = (store.proxy as any).onboarding;

    expect(flow.steps.welcome.status).toBe("active");
    expect(flow.steps.goal.status).toBe(null);
    expect(flow.steps.summary.status).toBe(null);
    expect("status" in flow.values.welcome).toBe(false);
  });

  it("spread flow-proxy содержит групповые + флоу-ключи", () => {
    const store = new Palistor({ config: makeOnboardingConfig() as any });
    const keys = Object.keys((store.proxy as any).onboarding);

    for (const k of ["submit", "reset", "dirty", "values", "currentStepKey", "steps", "nextStep", "back", "goTo", "validate", "history", "errors", "canGoBack"]) {
      expect(keys).toContain(k);
    }
    expect(keys).not.toContain(FLOW_STEPS_PROP);
    expect(keys).not.toContain("onSubmit");
  });
});
