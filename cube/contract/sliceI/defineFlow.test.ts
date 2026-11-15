/**
 * Contract (slice I, Phase 2.7): store/flow/defineFlow.test.ts through the
 * public API. Section 3 read store internals (nodes.allFlowStates, FlowState,
 * stepToFlow): it now checks the same facts through the flow node, flow.steps
 * and the persist snapshot (the flow's path keys `__flows`).
 *
 * Tests for defineFlow / defineStep — config structure and registration.
 *
 * Covers:
 *  1. defineStep — result structure + validation (status is reserved, a leaf is forbidden)
 *  2. defineFlow — flow node assembly (step groups + __flowSteps), key validation
 *  3. Registration in Palistor: navigation state, step order, values / getValues
 *  4. Proxy: flow state keys, steps access (index / key / current / length)
 *  5. Step status: derived from navigation, never enters values
 *  6. Flow-proxy spread: group + flow keys, no internal keys
 */
import { describe, it, expect, vi } from "vitest";
import { Palistor, defineFlow, defineStep } from "@impl";

/** The defineFlow marker: a service key of the flow's config node holding the step order. */
const FLOW_STEPS_PROP = "__flowSteps";

/** The flow paths a store persists navigation under (`__flows` in the snapshot). */
async function persistedFlowPaths(store: any): Promise<string[]> {
  const data: Record<string, string> = {};
  const driver = {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => { data[k] = v; },
    removeItem: (k: string) => { delete data[k]; },
  };
  await store.persist.enable({ key: "k", driver, debounce: 0 });
  await store.persist.flush();
  store.persist.disable();
  return Object.keys(JSON.parse(data.k).__flows ?? {});
}

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

// ─── 1. defineStep — structure ────────────────────────────────────────────────

describe("defineStep — result structure", () => {
  it("returns { key, config } with the same config", () => {
    const config = { name: { value: "" } };
    const step = defineStep("welcome", config);
    expect(step.key).toBe("welcome");
    expect(step.config).toBe(config);
  });

  it("throws on the reserved status field in a step config", () => {
    expect(() => defineStep("s", { status: { value: "" } } as any)).toThrow(/reserved/);
  });

  it("throws when the step config is a leaf (has value)", () => {
    expect(() => defineStep("s", { value: "" } as any)).toThrow(/group node/);
  });

  it("throws on an empty key", () => {
    expect(() => defineStep("" as string, {})).toThrow(/non-empty/);
  });
});

// ─── 2. defineFlow — node assembly ────────────────────────────────────────────

describe("defineFlow — result structure", () => {
  it("steps become child groups under their keys; the order lives in __flowSteps", () => {
    const welcome = { name: { value: "" } };
    const summary = {};
    const flow = defineFlow({
      steps: [defineStep("welcome", welcome), defineStep("summary", summary)],
    }) as any;

    expect(flow.welcome).toBe(welcome);
    expect(flow.summary).toBe(summary);
    expect(flow[FLOW_STEPS_PROP]).toEqual(["welcome", "summary"]);
  });

  it("onSubmit / beforeSubmit / afterSubmit are moved onto the flow node", () => {
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

  it("throws on an empty steps array", () => {
    expect(() => defineFlow({ steps: [] as any })).toThrow(/non-empty/);
  });

  it("throws on a duplicate step key", () => {
    expect(() =>
      defineFlow({ steps: [defineStep("a", {}), defineStep("a", {})] as any }),
    ).toThrow(/duplicate/);
  });

  it("throws on a reserved step key (values, steps, current, …)", () => {
    for (const key of ["values", "steps", "current", "submit", "value"]) {
      expect(() => defineFlow({ steps: [defineStep(key, {})] as any })).toThrow(/reserved/);
    }
  });
});

// ─── 3. Registration in Palistor ───────────────────────────────────────────────

describe("defineFlow — store registration", () => {
  it("navigation starts on the first step; steps keep their order; the flow is keyed by its path", async () => {
    const store = new Palistor({ config: makeOnboardingConfig() as any });
    const flow = (store.proxy as any).onboarding;

    expect(flow.currentStepIndex).toBe(0);
    expect(flow.canGoBack).toBe(false);
    expect(Object.keys(flow.steps).filter((k) => k !== "current" && k !== "length")).toEqual(["welcome", "goal", "summary"]);
    expect([...flow.steps]).toEqual([flow.steps.welcome, flow.steps.goal, flow.steps.summary]);
    expect([...flow.steps].map((step: any) => step.status)).toEqual(["active", null, null]);
    expect(flow.history).toEqual(["welcome"]);
    expect(await persistedFlowPaths(store)).toEqual(["onboarding"]);
  });

  it("the flow's values are all steps by key; __flowSteps does not leak", () => {
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

  it("initialValues are applied to step fields", () => {
    const store = new Palistor({
      config: makeOnboardingConfig() as any,
      initialValues: { onboarding: { welcome: { name: "Alice" } } } as any,
    });
    expect((store.proxy as any).onboarding.steps.welcome.name.value).toBe("Alice");
  });

  it("a nested flow (inside a group) also registers", async () => {
    const store = new Palistor({
      config: {
        section: {
          wizard: defineFlow({ steps: [defineStep("one", {}), defineStep("two", {})] }),
        },
      } as any,
    });
    const wizard = (store.proxy as any).section.wizard;
    expect(wizard.currentStepKey).toBe("one");
    wizard.nextStep();
    expect(wizard.currentStepKey).toBe("two");
    expect(await persistedFlowPaths(store)).toEqual(["section.wizard"]);
  });
});

// ─── 4. Proxy: flow state and steps ─────────────────────────────────────────

describe("defineFlow — flow proxy", () => {
  it("initial state: the first step is active, canGoBack=false, history=[first]", () => {
    const store = new Palistor({ config: makeOnboardingConfig() as any });
    const flow = (store.proxy as any).onboarding;

    expect(flow.currentStepKey).toBe("welcome");
    expect(flow.currentStepIndex).toBe(0);
    expect(flow.canGoBack).toBe(false);
    expect(flow.history).toEqual(["welcome"]);
    expect(flow.errors).toEqual([]);
  });

  it("steps: access by index, key, current and length; references are stable", () => {
    const store = new Palistor({ config: makeOnboardingConfig() as any });
    const flow = (store.proxy as any).onboarding;

    expect(flow.steps.length).toBe(3);
    expect(flow.steps[0]).toBe(flow.steps.welcome);
    expect(flow.steps[1]).toBe(flow.steps.goal);
    expect(flow.steps.current).toBe(flow.steps.welcome);
    expect(flow.steps).toBe(flow.steps); // steps-proxy cache
    expect([...flow.steps].length).toBe(3); // iteration
  });

  it("step fields are readable and writable through the step proxy", () => {
    const store = new Palistor({ config: makeOnboardingConfig() as any });
    const flow = (store.proxy as any).onboarding;

    flow.steps.welcome.name.value = "Bob";
    expect(flow.steps.welcome.name.value).toBe("Bob");
    expect(flow.values.welcome.name).toBe("Bob");
    expect(flow.dirty).toBe(true);
  });

  it("status: the first step is active, the rest are null; status never enters values", () => {
    const store = new Palistor({ config: makeOnboardingConfig() as any });
    const flow = (store.proxy as any).onboarding;

    expect(flow.steps.welcome.status).toBe("active");
    expect(flow.steps.goal.status).toBe(null);
    expect(flow.steps.summary.status).toBe(null);
    expect("status" in flow.values.welcome).toBe(false);
  });

  it("the flow-proxy spread contains group + flow keys", () => {
    const store = new Palistor({ config: makeOnboardingConfig() as any });
    const keys = Object.keys((store.proxy as any).onboarding);

    for (const k of ["submit", "reset", "dirty", "values", "currentStepKey", "steps", "nextStep", "back", "goTo", "validate", "history", "errors", "canGoBack"]) {
      expect(keys).toContain(k);
    }
    expect(keys).not.toContain(FLOW_STEPS_PROP);
    expect(keys).not.toContain("onSubmit");
  });
});
