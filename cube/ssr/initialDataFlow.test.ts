/**
 * `initialData` for a flow step (experiments/SsrPlan.md, Stage 3), Cube only.
 * Entering a step runs onEnter → the step's resolve → onReady. A step whose
 * result came as `initialData` has nothing to request: its first entry fires
 * onEnter and then onReady right away. onReady still fires once per step —
 * a later entry is a return to a resolved step, as after a fetch. In server
 * mode nothing is entered until `store.start()`.
 *
 * A declared dependency (`deps`, a `contextDeps` key) may move before that
 * first entry. The resolve re-runs then, as any resolved resolve does, and
 * the first entry still answers with onReady: once that run has landed.
 */
import { describe, it, expect, vi } from "vitest";
import { Palistor, defineFlow, defineStep } from "../index";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Three steps, each with a resolve and both callbacks. `order` is the
 * lifecycle as it happened ("enter:one", "resolve:one", "ready:one", …);
 * `seen` is what the callbacks of step `one` received as the flow's values.
 */
function wizardStore(options: Record<string, unknown> = {}) {
  const order: string[] = [];
  const seen: Array<{ on: string; values: unknown; store: unknown }> = [];
  const step = (key: string) => {
    const resolver = vi.fn(async () => { order.push(`resolve:${key}`); return { field: `fetched ${key}` }; });
    const config = {
      field: { value: "" },
      resolve: { resolver, onError: vi.fn() },
      onEnter: (values: any, store: unknown) => {
        order.push(`enter:${key}`);
        if (key === "one") seen.push({ on: "enter", values: structuredClone({ ...values.one }), store });
      },
      onReady: (values: any, store: unknown) => {
        order.push(`ready:${key}`);
        if (key === "one") seen.push({ on: "ready", values: structuredClone({ ...values.one }), store });
      },
    };
    return { resolver, step: defineStep(key, config as any) };
  };
  const one = step("one");
  const two = step("two");
  const three = step("three");
  const store = new Palistor({
    config: { wizard: defineFlow({ steps: [one.step, two.step, three.step] }) },
    ...options,
  } as any) as any;
  return { store, flow: store.proxy.wizard, order, seen, resolvers: { one: one.resolver, two: two.resolver, three: three.resolver } };
}

describe("a flow step that got initialData", () => {
  it("the first step: onEnter then onReady at construction, once each, with the data and without a request", async () => {
    const { store, flow, order, seen, resolvers } = wizardStore({ initialData: { wizard: { one: { field: "server one" } } } });
    expect(order).toEqual(["enter:one", "ready:one"]);
    expect(seen.map(({ on, values }) => ({ on, values }))).toEqual([
      { on: "enter", values: { field: "server one" } },
      { on: "ready", values: { field: "server one" } },
    ]);
    for (const call of seen) expect(call.store).toBe(store);
    expect(flow.loading).toBe(false);
    expect(flow.steps.one.loading).toBe(false);

    void flow.steps.one.field.value;
    await flush();
    expect(order).toEqual(["enter:one", "ready:one"]);
    expect(resolvers.one).not.toHaveBeenCalled();
    expect(flow.steps.one.field.value).toBe("server one");
    expect(store.proxy.dirty).toBe(false);
  });

  it("a later step: its callbacks wait for navigation to reach it, then fire once each without a request", async () => {
    const { flow, order, resolvers } = wizardStore({
      initialData: { wizard: { one: { field: "server one" }, two: { field: "server two" } } },
    });
    await flush();
    expect(order).toEqual(["enter:one", "ready:one"]); // step two has its data and has not been entered

    flow.nextStep();
    expect(order).toEqual(["enter:one", "ready:one", "enter:two", "ready:two"]);
    await flush();
    expect(resolvers.two).not.toHaveBeenCalled();
    expect(flow.steps.two.field.value).toBe("server two");
    expect(flow.loading).toBe(false);

    // A step without data is entered as always: onEnter → resolve → onReady.
    flow.nextStep();
    await flush();
    expect(order.slice(4)).toEqual(["enter:three", "resolve:three", "ready:three"]);
    expect(resolvers.three).toHaveBeenCalledTimes(1);
    expect(flow.steps.three.field.value).toBe("fetched three");
  });

  it("a step reached by goTo over steps that were never entered", async () => {
    const { flow, order, resolvers } = wizardStore({ initialData: { wizard: { three: { field: "server three" } } } });
    await flush();
    expect(order).toEqual(["enter:one", "resolve:one", "ready:one"]);

    flow.goTo("three");
    await flush();
    expect(order.slice(3)).toEqual(["enter:three", "ready:three"]);
    expect(resolvers.three).not.toHaveBeenCalled();
    expect(resolvers.two).not.toHaveBeenCalled();
  });

  it("re-entering the step fires onEnter again, not onReady, and still requests nothing", async () => {
    const { flow, order, resolvers } = wizardStore({
      initialData: { wizard: { one: { field: "server one" }, two: { field: "server two" } } },
    });
    flow.nextStep();
    flow.back();
    flow.nextStep();
    await flush();
    expect(order).toEqual(["enter:one", "ready:one", "enter:two", "ready:two", "enter:one", "enter:two"]);
    expect(resolvers.one).not.toHaveBeenCalled();
    expect(resolvers.two).not.toHaveBeenCalled();
  });

  it("the same lifecycle as a step whose resolver returned the data, minus the request", async () => {
    const seeded = wizardStore({ initialData: { wizard: { one: { field: "fetched one" } } } });
    const fetched = wizardStore();
    await flush();
    expect(fetched.order).toEqual(["enter:one", "resolve:one", "ready:one"]);
    expect(seeded.order).toEqual(["enter:one", "ready:one"]);
    expect(seeded.store.getValues()).toEqual(fetched.store.getValues());
    expect(seeded.store.proxy.dirty).toBe(fetched.store.proxy.dirty);

    // Leaving and coming back: onEnter only, in both. The step is resolved, however its result came.
    for (const { flow } of [seeded, fetched]) flow.nextStep();
    await flush();
    for (const { flow } of [seeded, fetched]) flow.back();
    await flush();
    const afterReturn = ["enter:two", "resolve:two", "ready:two", "enter:one"];
    expect(fetched.order.slice(3)).toEqual(afterReturn);
    expect(seeded.order.slice(2)).toEqual(afterReturn);
    expect(seeded.resolvers.one).not.toHaveBeenCalled();
    expect(fetched.resolvers.one).toHaveBeenCalledTimes(1);
  });
});

/**
 * Two steps for the dependency cases. `one` is a plain step. `two` got its
 * result as initialData, and its resolve declares `deps: ["wizard.one.a"]` and
 * `contextDeps: ["accountId"]`. Each run of its resolver waits on a gate, so a
 * test decides when a restarted run lands (`land[n](result)`). `readySaw` is
 * `two.b` as each onReady of step `two` saw it.
 */
function dependentStore(context?: Record<string, unknown>) {
  const order: string[] = [];
  const readySaw: unknown[] = [];
  const land: Array<(result: unknown) => void> = [];
  const resolver = vi.fn(() => {
    order.push("resolve:two");
    return new Promise<unknown>((resolve) => { land.push(resolve); });
  });
  const store = new Palistor({
    config: {
      wizard: defineFlow({
        steps: [
          defineStep("one", {
            a: { value: "" },
            other: { value: "" },
            onEnter: () => { order.push("enter:one"); },
            onReady: () => { order.push("ready:one"); },
          } as any),
          defineStep("two", {
            b: { value: "" },
            resolve: { resolver, onError: vi.fn(), deps: ["wizard.one.a"], contextDeps: ["accountId"] },
            onEnter: () => { order.push("enter:two"); },
            onReady: (values: any) => { order.push("ready:two"); readySaw.push(values.two.b); },
          } as any),
        ],
      }),
    },
    ...(context ? { context } : {}),
    initialData: { wizard: { two: { b: "server two" } } },
  } as any) as any;
  return { store, flow: store.proxy.wizard, order, readySaw, land, resolver };
}

type Dependent = ReturnType<typeof dependentStore>;

/** The construction: step `one` entered, step `two` holding its data and not entered. */
const CONSTRUCTED = ["enter:one", "ready:one"];

/**
 * Leaves step `two` and comes back: a return to a step whose onReady has
 * fired, so onEnter only and no request. (Step `one` has no resolve: its
 * onReady follows its onEnter on every entry.)
 */
async function reenterTwo({ flow, order, resolver }: Dependent) {
  const before = order.length;
  const calls = resolver.mock.calls.length;
  flow.back();
  flow.nextStep();
  await flush();
  expect(order.slice(before)).toEqual(["enter:one", "ready:one", "enter:two"]);
  expect(resolver).toHaveBeenCalledTimes(calls);
}

/** What moves a declared dependency of step `two` while the flow is still on step `one`. */
const TRIGGERS: Array<[string, () => Dependent, (s: Dependent) => void]> = [
  [
    "a path in `deps` changes",
    () => dependentStore({ accountId: "acc1" }),
    (s) => { s.flow.steps.one.a.value = "typed"; },
  ],
  [
    "a `contextDeps` key arrives through setContext",
    () => dependentStore(),
    (s) => { s.store.setContext({ accountId: "acc1" }); },
  ],
];

describe.each(TRIGGERS)("a step that got initialData, when %s before its first entry", (_trigger, make, change) => {
  it("the resolver re-runs at once, as any resolved resolve does; no callback of the step fires yet", async () => {
    const s = make();
    expect(s.order).toEqual(CONSTRUCTED);
    change(s);
    await flush();
    expect(s.order).toEqual([...CONSTRUCTED, "resolve:two"]);
    expect(s.resolver).toHaveBeenCalledTimes(1);

    s.land[0]({ b: "fetched two" });
    await flush();
    expect(s.order).toEqual([...CONSTRUCTED, "resolve:two"]); // landed with nobody on the step: onReady waits for an entry
    expect(s.flow.steps.two.b.value).toBe("fetched two");
  });

  it("entered while that run is pending: onEnter, then onReady exactly once, when the run lands", async () => {
    const s = make();
    change(s);
    await flush();

    s.flow.nextStep();
    await flush();
    expect(s.order).toEqual([...CONSTRUCTED, "resolve:two", "enter:two"]);
    expect(s.flow.steps.two.loading).toBe(true);
    expect(s.readySaw).toEqual([]);

    s.land[0]({ b: "fetched two" });
    await flush();
    expect(s.order).toEqual([...CONSTRUCTED, "resolve:two", "enter:two", "ready:two"]);
    expect(s.readySaw).toEqual(["fetched two"]);
    expect(s.resolver).toHaveBeenCalledTimes(1); // the entry started no run of its own

    await reenterTwo(s);
    expect(s.readySaw).toEqual(["fetched two"]);
  });

  it("entered after that run landed: onEnter, then onReady exactly once, without another request", async () => {
    const s = make();
    change(s);
    await flush();
    s.land[0]({ b: "fetched two" });
    await flush();

    s.flow.nextStep();
    await flush();
    expect(s.order).toEqual([...CONSTRUCTED, "resolve:two", "enter:two", "ready:two"]);
    expect(s.readySaw).toEqual(["fetched two"]);
    expect(s.resolver).toHaveBeenCalledTimes(1);

    await reenterTwo(s);
    expect(s.readySaw).toEqual(["fetched two"]);
  });
});

describe("a step that got initialData and declares dependencies, when none of them changes", () => {
  it.each([
    ["with its `contextDeps` key set", { accountId: "acc1" }],
    ["while its `contextDeps` key is still unset", undefined],
  ])("%s: entered as a step without dependencies — onEnter, onReady at once, no request", async (_title, context) => {
    const s = dependentStore(context);
    s.flow.steps.one.other.value = "typed"; // not a declared dependency
    await flush();
    expect(s.order).toEqual(CONSTRUCTED);

    s.flow.nextStep();
    expect(s.order).toEqual([...CONSTRUCTED, "enter:two", "ready:two"]);
    expect(s.readySaw).toEqual(["server two"]);
    await flush();
    expect(s.resolver).not.toHaveBeenCalled();

    await reenterTwo(s);
    expect(s.readySaw).toEqual(["server two"]);
  });

  it("a dependency that changes after the first entry re-runs the resolver and fires no second onReady", async () => {
    const s = dependentStore({ accountId: "acc1" });
    s.flow.nextStep();
    expect(s.order).toEqual([...CONSTRUCTED, "enter:two", "ready:two"]);

    s.flow.steps.one.a.value = "typed";
    await flush();
    s.land[0]({ b: "fetched two" });
    await flush();
    expect(s.order).toEqual([...CONSTRUCTED, "enter:two", "ready:two", "resolve:two"]);
    expect(s.flow.steps.two.b.value).toBe("fetched two");

    await reenterTwo(s);
    expect(s.readySaw).toEqual(["server two"]);
  });
});

describe("a flow step that got initialData, in server mode", () => {
  it("nothing is entered until store.start(); the step already reads as loaded", async () => {
    const { flow, order, resolvers } = wizardStore({ server: true, initialData: { wizard: { one: { field: "server one" } } } });
    await flush();
    expect(order).toEqual([]);
    expect(flow.steps.one.field.value).toBe("server one");
    expect(flow.loading).toBe(false);
    expect(flow.steps.one.loading).toBe(false);
    expect(resolvers.one).not.toHaveBeenCalled();
  });

  it("start() enters the step: onEnter then onReady, once each, without a request; a second start() does nothing", async () => {
    const { store, order, resolvers } = wizardStore({ server: true, initialData: { wizard: { one: { field: "server one" } } } });
    store.start();
    expect(order).toEqual(["enter:one", "ready:one"]);
    await flush();
    store.start();
    await flush();
    expect(order).toEqual(["enter:one", "ready:one"]);
    expect(resolvers.one).not.toHaveBeenCalled();
  });

  it("a step without data is held as loading and fetched by start(), as before", async () => {
    const { store, flow, order, resolvers } = wizardStore({ server: true, initialData: { wizard: { two: { field: "server two" } } } });
    await flush();
    expect(order).toEqual([]);
    expect(flow.steps.one.loading).toBe(true);

    store.start();
    await flush();
    expect(order).toEqual(["enter:one", "resolve:one", "ready:one"]);
    expect(resolvers.one).toHaveBeenCalledTimes(1);

    flow.nextStep();
    await flush();
    expect(order.slice(3)).toEqual(["enter:two", "ready:two"]);
    expect(resolvers.two).not.toHaveBeenCalled();
  });
});
