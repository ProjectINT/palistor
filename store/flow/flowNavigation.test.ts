/**
 * Тесты навигационной модели defineFlow.
 *
 * Покрывает:
 *  1. nextStep / back / goTo — переходы, стек, статусы, history
 *  2. Ветвление через isVisible — скрытые шаги пропускаются
 *  3. onSubmit шага: 3-й аргумент — flow-proxy (навигация деструктуризацией)
 *  4. Lifecycle: onEnter → resolve (eager) → onReady; кэш resolve при back()
 *  5. Финализация nextStep(): submit всех шагов; скрытая ветка не блокирует;
 *     ошибки валидации → flow.errors, onSubmit не вызывается
 *  6. flow.validate() / flow.errors / flow.isInvalid / step.isInvalid
 *  7. Композитный flow.loading
 *  8. reset: навигация + значения + resolve + повторный lifecycle
 */
import { describe, it, expect, vi } from "vitest";
import { defineFlow, defineStep } from "./defineFlow";
import { Palistor } from "../store";

function flushPromises() {
  return new Promise<void>((r) => setTimeout(r, 0));
}

// ─── 1. Навигация ────────────────────────────────────────────────────────────

describe("flow — навигация", () => {
  function makeStore() {
    return new Palistor({
      config: {
        wizard: defineFlow({
          steps: [
            defineStep("one", { a: { value: "" } }),
            defineStep("two", { b: { value: "" } }),
            defineStep("three", { c: { value: "" } }),
          ],
        }),
      } as any,
    });
  }

  it("nextStep: переход к следующему шагу, статусы и history обновляются", () => {
    const flow = (makeStore().proxy as any).wizard;

    flow.nextStep();

    expect(flow.currentStepKey).toBe("two");
    expect(flow.currentStepIndex).toBe(1);
    expect(flow.canGoBack).toBe(true);
    expect(flow.history).toEqual(["one", "two"]);
    expect(flow.steps.one.status).toBe("completed");
    expect(flow.steps.two.status).toBe("active");
    expect(flow.steps.three.status).toBe(null);
    expect(flow.steps.current).toBe(flow.steps.two);
  });

  it("back: возврат по стеку; покинутый шаг — completed", () => {
    const flow = (makeStore().proxy as any).wizard;

    flow.nextStep();
    flow.nextStep();
    expect(flow.currentStepKey).toBe("three");

    flow.back();
    expect(flow.currentStepKey).toBe("two");
    expect(flow.steps.three.status).toBe("completed"); // был посещён
    expect(flow.history).toEqual(["one", "two"]);

    flow.back();
    expect(flow.currentStepKey).toBe("one");
    expect(flow.canGoBack).toBe(false);
  });

  it("back при пустом стеке — no-op", () => {
    const flow = (makeStore().proxy as any).wizard;
    flow.back();
    expect(flow.currentStepKey).toBe("one");
  });

  it("goTo по ключу и индексу; пуш в стек", () => {
    const flow = (makeStore().proxy as any).wizard;

    flow.goTo("three");
    expect(flow.currentStepKey).toBe("three");
    expect(flow.history).toEqual(["one", "three"]);

    flow.goTo(0);
    expect(flow.currentStepKey).toBe("one");
    // после goTo(0) индекс 0, но стек непуст — canGoBack остаётся true
    expect(flow.currentStepIndex).toBe(0);
    expect(flow.canGoBack).toBe(true);

    flow.back();
    expect(flow.currentStepKey).toBe("three");
  });

  it("goTo бросает на неизвестном ключе и выходе за диапазон", () => {
    const flow = (makeStore().proxy as any).wizard;
    expect(() => flow.goTo("nope")).toThrow(/unknown step key/);
    expect(() => flow.goTo(99)).toThrow(/out of range/);
  });

  it("goTo в текущий шаг — no-op (стек не растёт)", () => {
    const flow = (makeStore().proxy as any).wizard;
    flow.goTo("one");
    expect(flow.canGoBack).toBe(false);
    expect(flow.history).toEqual(["one"]);
  });
});

// ─── 2. Ветвление через isVisible ────────────────────────────────────────────

describe("flow — ветвление через isVisible", () => {
  function makeBranchingStore(onSubmit = vi.fn(async () => undefined)) {
    return new Palistor({
      config: {
        onboarding: defineFlow({
          steps: [
            defineStep("goalSelection", { goal: { value: "" } }),
            defineStep("riskAssessment", {
              riskLevel: { value: "", isRequired: true },
              isVisible: (values: any) => values.goalSelection.goal === "invest",
            }),
            defineStep("savingsPlan", {
              monthlyAmount: { value: 0 },
              isVisible: (values: any) => values.goalSelection.goal === "save",
            }),
            defineStep("summary", {}),
          ],
          onSubmit,
        }),
      } as any,
    });
  }

  it("nextStep пропускает скрытые шаги (goal=save → мимо riskAssessment)", () => {
    const flow = (makeBranchingStore().proxy as any).onboarding;

    flow.steps.goalSelection.goal.value = "save";
    flow.nextStep();

    expect(flow.currentStepKey).toBe("savingsPlan");
    expect(flow.history).toEqual(["goalSelection", "savingsPlan"]);
  });

  it("goal=invest → riskAssessment виден и достигается", () => {
    const flow = (makeBranchingStore().proxy as any).onboarding;

    flow.steps.goalSelection.goal.value = "invest";
    flow.nextStep();

    expect(flow.currentStepKey).toBe("riskAssessment");
  });

  it("скрытые шаги сохраняют значения и остаются в flow.values", () => {
    const flow = (makeBranchingStore().proxy as any).onboarding;

    flow.steps.goalSelection.goal.value = "save";
    expect(flow.values.riskAssessment).toEqual({ riskLevel: "" });
  });
});

// ─── 3. onSubmit шага: 3-й аргумент — flow proxy ─────────────────────────────

describe("flow — onSubmit шага получает flow proxy", () => {
  it("step.submit() → onSubmit(values, store, flow); деструктуризация nextStep работает", async () => {
    const seen: any = {};
    const store = new Palistor({
      config: {
        wizard: defineFlow({
          steps: [
            defineStep("first", {
              name: { value: "Alice" },
              onSubmit: async (values: any, s: any, { nextStep, goTo }: any) => {
                seen.values = values;
                seen.store = s;
                seen.goTo = typeof goTo;
                nextStep();
              },
            }),
            defineStep("second", {}),
          ],
        }),
      } as any,
    });
    const flow = (store.proxy as any).wizard;

    const result = await flow.steps.first.submit();

    expect(result.success).toBe(true);
    expect(seen.values).toEqual({ name: "Alice" });
    expect(seen.store).toBe(store);
    expect(seen.goTo).toBe("function");
    expect(flow.currentStepKey).toBe("second");
  });

  it("onSubmit шага может ветвиться через goTo", async () => {
    const store = new Palistor({
      config: {
        wizard: defineFlow({
          steps: [
            defineStep("choice", {
              kind: { value: "b" },
              onSubmit: async (values: any, _s: any, { goTo }: any) => {
                goTo(values.kind === "a" ? "pathA" : "pathB");
              },
            }),
            defineStep("pathA", {}),
            defineStep("pathB", {}),
          ],
        }),
      } as any,
    });
    const flow = (store.proxy as any).wizard;

    await flow.steps.choice.submit();
    expect(flow.currentStepKey).toBe("pathB");
  });
});

// ─── 4. Lifecycle: onEnter → resolve → onReady ───────────────────────────────

describe("flow — lifecycle шага", () => {
  it("инициализация: первый шаг входится при создании store (onEnter → onReady)", () => {
    const order: string[] = [];
    new Palistor({
      config: {
        wizard: defineFlow({
          steps: [
            defineStep("first", {
              onEnter: () => order.push("enter"),
              onReady: () => order.push("ready"),
            }),
            defineStep("second", {}),
          ],
        }),
      } as any,
    });
    expect(order).toEqual(["enter", "ready"]);
  });

  it("onEnter получает flow-scoped values (все шаги по ключам)", () => {
    let seen: any = null;
    const store = new Palistor({
      config: {
        wizard: defineFlow({
          steps: [
            defineStep("a", { x: { value: 1 } }),
            defineStep("b", {
              y: { value: 2 },
              onEnter: (values: any) => { seen = { ...values, a: { ...values.a } }; },
            }),
          ],
        }),
      } as any,
    });
    (store.proxy as any).wizard.nextStep();
    expect(seen.a).toEqual({ x: 1 });
    expect(seen.b).toEqual({ y: 2 });
  });

  it("вход в шаг с resolve: eager-запуск, loading, onReady после завершения", async () => {
    const order: string[] = [];
    const resolver = vi.fn(async (values: any) => {
      order.push("resolve");
      // resolver получает ROOT-values: путь от корня store
      expect(values.wizard.a.x).toBe("seed");
      return { data: "loaded" };
    });

    const store = new Palistor({
      config: {
        wizard: defineFlow({
          steps: [
            defineStep("a", { x: { value: "seed" } }),
            defineStep("b", {
              data: { value: "" },
              onEnter: () => order.push("enter"),
              onReady: () => order.push("ready"),
              resolve: { resolver, onError: vi.fn() },
            }),
          ],
        }),
      } as any,
    });
    const flow = (store.proxy as any).wizard;

    expect(resolver).not.toHaveBeenCalled(); // до входа resolve не запускается

    flow.nextStep();
    expect(order).toEqual(["enter", "resolve"]); // onEnter до завершения resolve
    expect(flow.steps.b.loading).toBe(true);
    expect(flow.loading).toBe(true); // композитный

    await flushPromises();

    expect(order).toEqual(["enter", "resolve", "ready"]);
    expect(flow.steps.b.data.value).toBe("loaded");
    expect(flow.loading).toBe(false);
  });

  it("back к шагу с кэшированным resolve: resolver и onReady не перезапускаются, onEnter — да", async () => {
    const onEnter = vi.fn();
    const onReady = vi.fn();
    const resolver = vi.fn(async () => ({ data: "x" }));

    const store = new Palistor({
      config: {
        wizard: defineFlow({
          steps: [
            defineStep("a", {}),
            defineStep("b", {
              data: { value: "" },
              onEnter,
              onReady,
              resolve: { resolver, onError: vi.fn() },
            }),
            defineStep("c", {}),
          ],
        }),
      } as any,
    });
    const flow = (store.proxy as any).wizard;

    flow.nextStep(); // → b, resolve
    await flushPromises();
    flow.nextStep(); // → c
    flow.back();     // → b, resolve закэширован
    await flushPromises();

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onEnter).toHaveBeenCalledTimes(2); // каждый вход
  });
});

// ─── 5. Финализация через nextStep ───────────────────────────────────────────

describe("flow — финализация", () => {
  it("nextStep на последнем видимом шаге → flow onSubmit со всеми значениями", async () => {
    const onSubmit = vi.fn(async () => undefined);
    const store = new Palistor({
      config: {
        wizard: defineFlow({
          steps: [
            defineStep("a", { x: { value: "1" } }),
            defineStep("b", { y: { value: "2" } }),
          ],
          onSubmit,
        }),
      } as any,
    });
    const flow = (store.proxy as any).wizard;

    flow.nextStep(); // a → b
    flow.nextStep(); // финализация
    await flushPromises();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual({ a: { x: "1" }, b: { y: "2" } });
    expect(flow.currentStepKey).toBe("b"); // навигация не меняется
    expect(flow.errors).toEqual([]);
  });

  it("скрытая ветка с isRequired не блокирует финализацию", async () => {
    const onSubmit = vi.fn(async () => undefined);
    const store = new Palistor({
      config: {
        onboarding: defineFlow({
          steps: [
            defineStep("goal", { goal: { value: "save" } }),
            defineStep("risk", {
              riskLevel: { value: "", isRequired: true },
              isVisible: (values: any) => values.goal.goal === "invest",
            }),
            defineStep("summary", {}),
          ],
          onSubmit,
        }),
      } as any,
    });
    const flow = (store.proxy as any).onboarding;

    flow.nextStep(); // goal → summary (risk скрыт)
    expect(flow.currentStepKey).toBe("summary");

    flow.nextStep(); // финализация
    await flushPromises();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(flow.errors).toEqual([]);
  });

  it("ошибка валидации ВИДИМОГО шага: onSubmit не вызывается, ошибки в flow.errors", async () => {
    const onSubmit = vi.fn(async () => undefined);
    const store = new Palistor({
      config: {
        wizard: defineFlow({
          steps: [
            defineStep("a", { name: { value: "", isRequired: true } }),
            defineStep("b", {}),
          ],
          onSubmit,
        }),
      } as any,
    });
    const flow = (store.proxy as any).wizard;

    flow.nextStep(); // a → b
    flow.nextStep(); // финализация — name пуст
    await flushPromises();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(flow.currentStepKey).toBe("b");
    // пути ошибок относительны flow-ноды (как в SubmitResult при flow.submit())
    expect(flow.errors).toEqual([{ path: "a.name", message: "required" }]);
  });
});

// ─── 6. validate / errors / isInvalid ────────────────────────────────────────

describe("flow — validate и агрегатная валидность", () => {
  function makeStore() {
    return new Palistor({
      config: {
        wizard: defineFlow({
          steps: [
            defineStep("a", { name: { value: "", isRequired: true } }),
            defineStep("b", { email: { value: "", isRequired: true } }),
            defineStep("hidden", {
              secret: { value: "", isRequired: true },
              isVisible: () => false,
            }),
          ],
        }),
      } as any,
    });
  }

  it("validate() охватывает только посещённые шаги", () => {
    const flow = (makeStore().proxy as any).wizard;

    // посещён только "a"
    expect(flow.validate()).toEqual([{ path: "a.name", message: "required" }]);

    flow.nextStep(); // b посещён
    expect(flow.validate()).toEqual([
      { path: "a.name", message: "required" },
      { path: "b.email", message: "required" },
    ]);
  });

  it("errors реактивно хранит результат последнего validate()", () => {
    const flow = (makeStore().proxy as any).wizard;
    expect(flow.errors).toEqual([]);
    flow.validate();
    expect(flow.errors.length).toBe(1);

    flow.steps.a.name.value = "ok";
    expect(flow.validate()).toEqual([]);
    expect(flow.errors).toEqual([]);
  });

  it("скрытый шаг не участвует в validate(), даже будучи посещённым", () => {
    const flow = (makeStore().proxy as any).wizard;
    flow.goTo("hidden");
    expect(flow.validate().map((e: any) => e.path)).not.toContain("hidden.secret");
  });

  it("flow.isInvalid — агрегат посещённых шагов; step.isInvalid — по шагу", () => {
    const flow = (makeStore().proxy as any).wizard;

    expect(flow.isInvalid).toBe(true); // a посещён и невалиден
    expect(flow.steps.a.isInvalid).toBe(true);
    expect(flow.steps.b.isInvalid).toBe(true); // step-level не зависит от посещения

    flow.steps.a.name.value = "ok";
    expect(flow.steps.a.isInvalid).toBe(false);
    expect(flow.isInvalid).toBe(false); // b ещё не посещён
  });
});

// ─── 7. Reset ────────────────────────────────────────────────────────────────

describe("flow — reset", () => {
  it("flow.reset(): навигация и значения к initial, lifecycle первого шага заново", async () => {
    const onEnter = vi.fn();
    const resolver = vi.fn(async () => ({ data: "loaded" }));
    const store = new Palistor({
      config: {
        wizard: defineFlow({
          steps: [
            defineStep("a", { x: { value: "init" }, onEnter, resolve: { resolver, onError: vi.fn() } }),
            defineStep("b", {}),
          ],
        }),
      } as any,
    });
    const flow = (store.proxy as any).wizard;
    await flushPromises();
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(resolver).toHaveBeenCalledTimes(1);

    flow.steps.a.x.value = "changed";
    flow.nextStep();
    expect(flow.currentStepKey).toBe("b");

    flow.reset();
    await flushPromises();

    expect(flow.currentStepKey).toBe("a");
    expect(flow.canGoBack).toBe(false);
    expect(flow.steps.b.status).toBe(null);
    expect(onEnter).toHaveBeenCalledTimes(2);
    expect(resolver).toHaveBeenCalledTimes(2); // resolve-состояние сброшено
    expect(flow.errors).toEqual([]);
  });

  it("store.reset() сбрасывает навигацию вложенных флоу", () => {
    const store = new Palistor({
      config: {
        wizard: defineFlow({
          steps: [defineStep("a", { x: { value: "" } }), defineStep("b", {})],
        }),
      } as any,
    });
    const flow = (store.proxy as any).wizard;

    flow.nextStep();
    expect(flow.currentStepKey).toBe("b");

    store.reset();
    expect(flow.currentStepKey).toBe("a");
    expect(flow.canGoBack).toBe(false);
  });
});
