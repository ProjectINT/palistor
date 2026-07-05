/**
 * Tests for the defineFlow navigation model.
 *
 * Covers:
 *  1. nextStep / back / goTo — transitions, the stack, statuses, history
 *  2. Branching via isVisible — hidden steps are skipped
 *  3. A step's onSubmit: the 3rd argument is the flow proxy (navigation via destructuring)
 *  4. Lifecycle: onEnter → resolve (eager) → onReady; resolve cache on back()
 *  5. nextStep() finalization: submit of all steps; a hidden branch doesn't block;
 *     validation errors → flow.errors, onSubmit is not called
 *  6. flow.validate() / flow.errors / flow.isInvalid / step.isInvalid
 *  7. Composite flow.loading
 *  8. reset: navigation + values + resolve + repeated lifecycle
 */
import { describe, it, expect, vi } from "vitest";
import { defineFlow, defineStep } from "./defineFlow";
import { Palistor } from "../store";

function flushPromises() {
  return new Promise<void>((r) => setTimeout(r, 0));
}

// ─── 1. Navigation ───────────────────────────────────────────────────────────

describe("flow — navigation", () => {
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

  it("nextStep: moves to the next step, statuses and history update", () => {
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

  it("back: returns along the stack; the left step is completed", () => {
    const flow = (makeStore().proxy as any).wizard;

    flow.nextStep();
    flow.nextStep();
    expect(flow.currentStepKey).toBe("three");

    flow.back();
    expect(flow.currentStepKey).toBe("two");
    expect(flow.steps.three.status).toBe("completed"); // was visited
    expect(flow.history).toEqual(["one", "two"]);

    flow.back();
    expect(flow.currentStepKey).toBe("one");
    expect(flow.canGoBack).toBe(false);
  });

  it("back on an empty stack — no-op", () => {
    const flow = (makeStore().proxy as any).wizard;
    flow.back();
    expect(flow.currentStepKey).toBe("one");
  });

  it("goTo by key and index; pushes onto the stack", () => {
    const flow = (makeStore().proxy as any).wizard;

    flow.goTo("three");
    expect(flow.currentStepKey).toBe("three");
    expect(flow.history).toEqual(["one", "three"]);

    flow.goTo(0);
    expect(flow.currentStepKey).toBe("one");
    // after goTo(0) the index is 0, but the stack is non-empty — canGoBack stays true
    expect(flow.currentStepIndex).toBe(0);
    expect(flow.canGoBack).toBe(true);

    flow.back();
    expect(flow.currentStepKey).toBe("three");
  });

  it("goTo throws on an unknown key and an out-of-range index", () => {
    const flow = (makeStore().proxy as any).wizard;
    expect(() => flow.goTo("nope")).toThrow(/unknown step key/);
    expect(() => flow.goTo(99)).toThrow(/out of range/);
  });

  it("goTo to the current step — no-op (the stack does not grow)", () => {
    const flow = (makeStore().proxy as any).wizard;
    flow.goTo("one");
    expect(flow.canGoBack).toBe(false);
    expect(flow.history).toEqual(["one"]);
  });
});

// ─── 2. Branching via isVisible ──────────────────────────────────────────────

describe("flow — branching via isVisible", () => {
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

  it("nextStep skips hidden steps (goal=save → past riskAssessment)", () => {
    const flow = (makeBranchingStore().proxy as any).onboarding;

    flow.steps.goalSelection.goal.value = "save";
    flow.nextStep();

    expect(flow.currentStepKey).toBe("savingsPlan");
    expect(flow.history).toEqual(["goalSelection", "savingsPlan"]);
  });

  it("goal=invest → riskAssessment is visible and reached", () => {
    const flow = (makeBranchingStore().proxy as any).onboarding;

    flow.steps.goalSelection.goal.value = "invest";
    flow.nextStep();

    expect(flow.currentStepKey).toBe("riskAssessment");
  });

  it("hidden steps keep their values and stay in flow.values", () => {
    const flow = (makeBranchingStore().proxy as any).onboarding;

    flow.steps.goalSelection.goal.value = "save";
    expect(flow.values.riskAssessment).toEqual({ riskLevel: "" });
  });
});

// ─── 3. A step's onSubmit: the 3rd argument is the flow proxy──────────────────────────

describe("flow — a step's onSubmit receives the flow proxy", () => {
  it("step.submit() → onSubmit(values, store, flow); destructured nextStep works", async () => {
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

  it("a step's onSubmit can branch via goTo", async () => {
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

// ─── 4. Lifecycle: onEnter → resolve → onReady ──────────────────────────────

describe("flow — step lifecycle", () => {
  it("initialization: the first step is entered at store creation (onEnter → onReady)", () => {
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

  it("onEnter receives flow-scoped values (all steps by key)", () => {
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

  it("entering a step with resolve: eager launch, loading, onReady after completion", async () => {
    const order: string[] = [];
    const resolver = vi.fn(async (values: any) => {
      order.push("resolve");
      // the resolver receives ROOT values: the path starts from the store root
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

    expect(resolver).not.toHaveBeenCalled(); // resolve does not launch before entry

    flow.nextStep();
    expect(order).toEqual(["enter", "resolve"]); // onEnter before the resolve completes
    expect(flow.steps.b.loading).toBe(true);
    expect(flow.loading).toBe(true); // composite

    await flushPromises();

    expect(order).toEqual(["enter", "resolve", "ready"]);
    expect(flow.steps.b.data.value).toBe("loaded");
    expect(flow.loading).toBe(false);
  });

  it("back to a step with a cached resolve: the resolver and onReady don't re-run, onEnter does", async () => {
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
    flow.back();     // → b, resolve is cached
    await flushPromises();

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onEnter).toHaveBeenCalledTimes(2); // every entry
  });
});

// ─── 5. Finalization via nextStep ────────────────────────────────────────────

describe("flow — finalization", () => {
  it("nextStep on the last visible step → flow onSubmit with all values", async () => {
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
    flow.nextStep(); // finalization
    await flushPromises();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual({ a: { x: "1" }, b: { y: "2" } });
    expect(flow.currentStepKey).toBe("b"); // navigation is unchanged
    expect(flow.errors).toEqual([]);
  });

  it("a hidden branch with isRequired does not block finalization", async () => {
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

    flow.nextStep(); // goal → summary (risk is hidden)
    expect(flow.currentStepKey).toBe("summary");

    flow.nextStep(); // finalization
    await flushPromises();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(flow.errors).toEqual([]);
  });

  it("a validation error on a VISIBLE step: onSubmit is not called, errors land in flow.errors", async () => {
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
    flow.nextStep(); // finalization — name is empty
    await flushPromises();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(flow.currentStepKey).toBe("b");
    // error paths are relative to the flow node (like SubmitResult on flow.submit())
    expect(flow.errors).toEqual([{ path: "a.name", message: "required" }]);
  });
});

// ─── 6. validate / errors / isInvalid ────────────────────────────────────────

describe("flow — validate and aggregate validity", () => {
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

  it("validate() covers only the visited steps", () => {
    const flow = (makeStore().proxy as any).wizard;

    // only "a" has been visited
    expect(flow.validate()).toEqual([{ path: "a.name", message: "required" }]);

    flow.nextStep(); // b is visited
    expect(flow.validate()).toEqual([
      { path: "a.name", message: "required" },
      { path: "b.email", message: "required" },
    ]);
  });

  it("errors reactively stores the last validate() result", () => {
    const flow = (makeStore().proxy as any).wizard;
    expect(flow.errors).toEqual([]);
    flow.validate();
    expect(flow.errors.length).toBe(1);

    flow.steps.a.name.value = "ok";
    expect(flow.validate()).toEqual([]);
    expect(flow.errors).toEqual([]);
  });

  it("a hidden step does not participate in validate(), even when visited", () => {
    const flow = (makeStore().proxy as any).wizard;
    flow.goTo("hidden");
    expect(flow.validate().map((e: any) => e.path)).not.toContain("hidden.secret");
  });

  it("flow.isInvalid aggregates visited steps; step.isInvalid is per-step", () => {
    const flow = (makeStore().proxy as any).wizard;

    expect(flow.isInvalid).toBe(true); // a is visited and invalid
    expect(flow.steps.a.isInvalid).toBe(true);
    expect(flow.steps.b.isInvalid).toBe(true); // step-level doesn't depend on visits

    flow.steps.a.name.value = "ok";
    expect(flow.steps.a.isInvalid).toBe(false);
    expect(flow.isInvalid).toBe(false); // b hasn't been visited yet
  });
});

// ─── 7. Reset ────────────────────────────────────────────────────────────────

describe("flow — reset", () => {
  it("flow.reset(): navigation and values back to initial, the first step's lifecycle re-runs", async () => {
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
    expect(resolver).toHaveBeenCalledTimes(2); // resolve state was reset
    expect(flow.errors).toEqual([]);
  });

  it("store.reset() resets the navigation of nested flows", () => {
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
