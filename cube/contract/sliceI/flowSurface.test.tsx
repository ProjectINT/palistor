/**
 * Contract (slice I, Phase 2.7): flow behavior store implemented but never
 * tested — the useForm boundary on navigation, flow.steps as a collection,
 * the step entry lifecycle around resolves, hidden steps on submit, reset
 * scope, navigation in the persist snapshot, fieldMapping on flow and step
 * nodes.
 *
 * Runs in both vitest projects: `store` proves the test itself is right,
 * `cube` shows parity. Imports only from "@impl".
 */

import { describe, it, expect, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { Palistor, defineFlow, defineList, defineStep, useForm } from "@impl";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function memoryDriver(seed?: Record<string, string>) {
  const data: Record<string, string> = { ...seed };
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => { data[k] = v; },
    removeItem: (k: string) => { delete data[k]; },
  };
}

function wizardConfig(extra: Record<string, unknown> = {}) {
  return {
    wizard: defineFlow({
      steps: [
        defineStep("one", { a: { value: "", isRequired: true }, ...extra }),
        defineStep("two", { b: { value: "" } }),
        defineStep("three", { c: { value: "" } }),
      ],
    }),
  };
}

// ─── 1. useForm boundary ─────────────────────────────────────────────────────

describe("flow — useForm re-renders on navigation", () => {
  it("currentStepKey and canGoBack follow nextStep / back / goTo", () => {
    const store = new Palistor({ config: wizardConfig() as any });
    const flow = (store.proxy as any).wizard;

    function Nav() {
      const form = useForm(store) as any;
      return <span data-testid="nav">{`${form.wizard.currentStepKey}:${form.wizard.canGoBack}`}</span>;
    }
    const { getByTestId } = render(<Nav />);
    expect(getByTestId("nav").textContent).toBe("one:false");

    act(() => flow.nextStep());
    expect(getByTestId("nav").textContent).toBe("two:true");
    act(() => flow.goTo("three"));
    expect(getByTestId("nav").textContent).toBe("three:true");
    act(() => flow.back());
    act(() => flow.back());
    expect(getByTestId("nav").textContent).toBe("one:false");
  });

  it("step statuses and steps.current re-render a component that read them", () => {
    const store = new Palistor({ config: wizardConfig() as any });
    const flow = (store.proxy as any).wizard;

    function Steps() {
      const form = useForm(store) as any;
      const steps = form.wizard.steps;
      const statuses = [...steps].map((s: any) => s.status ?? "-").join(",");
      return <span data-testid="steps">{`${statuses}|${steps.current === steps.two ? "two" : "other"}`}</span>;
    }
    const { getByTestId } = render(<Steps />);
    expect(getByTestId("steps").textContent).toBe("active,-,-|other");

    act(() => flow.nextStep());
    expect(getByTestId("steps").textContent).toBe("completed,active,-|two");
    act(() => flow.nextStep());
    expect(getByTestId("steps").textContent).toBe("completed,completed,active|other");
  });

  it("a component that reads only a step's field does not re-render on navigation", () => {
    const store = new Palistor({ config: wizardConfig() as any });
    const flow = (store.proxy as any).wizard;
    let renders = 0;

    function Field() {
      const form = useForm(store) as any;
      renders++;
      return <span data-testid="b">{form.wizard.steps.two.b.value}</span>;
    }
    render(<Field />);
    const before = renders;

    act(() => flow.nextStep());
    act(() => flow.back());
    expect(renders).toBe(before);

    act(() => { flow.steps.two.b.value = "x"; });
    expect(renders).toBe(before + 1);
  });

  it("a subtree useForm(flow) follows navigation and flow.errors", () => {
    const store = new Palistor({ config: wizardConfig() as any });
    const flow = (store.proxy as any).wizard;

    function Child({ wizard }: { wizard: any }) {
      const w = useForm(wizard) as any;
      return <span data-testid="child">{`${w.currentStepKey}:${w.errors.length}`}</span>;
    }
    function Parent() {
      const form = useForm(store) as any;
      return <Child wizard={form.wizard} />;
    }
    const { getByTestId } = render(<Parent />);
    expect(getByTestId("child").textContent).toBe("one:0");

    act(() => { flow.validate(); });
    expect(getByTestId("child").textContent).toBe("one:1");
    act(() => flow.nextStep());
    expect(getByTestId("child").textContent).toBe("two:1");
  });

  it("flow.isInvalid and step.isInvalid re-render when a step's field becomes valid", () => {
    const store = new Palistor({ config: wizardConfig() as any });
    const flow = (store.proxy as any).wizard;

    function Validity() {
      const form = useForm(store) as any;
      return <span data-testid="v">{`${form.wizard.isInvalid}/${form.wizard.steps.one.isInvalid}`}</span>;
    }
    const { getByTestId } = render(<Validity />);
    expect(getByTestId("v").textContent).toBe("true/true");

    act(() => { flow.steps.one.a.value = "ok"; });
    expect(getByTestId("v").textContent).toBe("false/false");
  });

  it("composite flow.loading re-renders while a step resolves", async () => {
    let finish!: (v: unknown) => void;
    const resolver = vi.fn(() => new Promise((r) => { finish = r; }));
    const store = new Palistor({
      config: {
        wizard: defineFlow({
          steps: [
            defineStep("one", {}),
            defineStep("two", { data: { value: "" }, resolve: { resolver, onError: () => {} } }),
          ],
        }),
      } as any,
    });
    const flow = (store.proxy as any).wizard;

    function Loading() {
      const form = useForm(store) as any;
      return <span data-testid="l">{form.wizard.loading ? "loading" : "idle"}</span>;
    }
    const { getByTestId } = render(<Loading />);
    expect(getByTestId("l").textContent).toBe("idle");

    act(() => flow.nextStep());
    expect(getByTestId("l").textContent).toBe("loading");

    await act(async () => { finish({ data: "x" }); await flush(); });
    expect(getByTestId("l").textContent).toBe("idle");
    expect(flow.steps.two.data.value).toBe("x");
  });
});

// ─── 2. flow.steps as a collection ───────────────────────────────────────────

describe("flow — the steps collection and the flow surface", () => {
  it("spread and keys: the step keys, then current and length", () => {
    const flow = (new Palistor({ config: wizardConfig() as any }).proxy as any).wizard;

    expect(Object.keys(flow.steps)).toEqual(["one", "two", "three", "current", "length"]);
    const spread = { ...flow.steps };
    expect(spread.two).toBe(flow.steps.two);
    expect(spread.current).toBe(flow.steps.one);
    expect(spread.length).toBe(3);
    expect(flow.steps[3]).toBeUndefined();
    expect(flow.steps.nope).toBeUndefined();
  });

  it("the collection and the navigation state are read-only", () => {
    const flow = (new Palistor({ config: wizardConfig() as any }).proxy as any).wizard;

    expect(() => { flow.steps.two = {}; }).toThrow(TypeError);
    expect(() => { flow.steps.extra = {}; }).toThrow(TypeError);
    expect(() => { flow.currentStepKey = "three"; }).toThrow(TypeError);
    expect(flow.currentStepKey).toBe("one");
  });

  it("a step spreads as a group: status stays off the spread", () => {
    const flow = (new Palistor({ config: wizardConfig() as any }).proxy as any).wizard;

    expect(Object.keys(flow.steps.one)).toEqual([
      "value", "submitting", "dirty", "revalidate", "loading", "values", "submit", "reset",
    ]);
    expect(flow.steps.one.status).toBe("active");
  });

  it("navigation methods are stable references and work destructured", () => {
    const flow = (new Palistor({ config: wizardConfig() as any }).proxy as any).wizard;

    for (const k of ["nextStep", "back", "goTo", "validate", "submit", "reset"]) expect(flow[k]).toBe(flow[k]);
    expect(flow.steps).toBe(flow.steps);

    const { nextStep, back, goTo } = flow;
    nextStep();
    goTo(2);
    back();
    expect(flow.history).toEqual(["one", "two"]);
  });
});

// ─── 3. Entry lifecycle around resolves ──────────────────────────────────────

describe("flow — step entry lifecycle", () => {
  it("reading a step's status or isInvalid does not start its resolve; entering does", async () => {
    const resolver = vi.fn(async () => ({ data: "x" }));
    const onReady = vi.fn();
    const store = new Palistor({
      config: {
        wizard: defineFlow({
          steps: [
            defineStep("one", {}),
            defineStep("two", { data: { value: "" }, onReady, resolve: { resolver, onError: () => {} } }),
          ],
        }),
      } as any,
    });
    const flow = (store.proxy as any).wizard;

    expect(flow.steps.two.status).toBe(null);
    expect(flow.steps.two.isInvalid).toBe(false);
    await flush();
    expect(resolver).not.toHaveBeenCalled();

    flow.nextStep();
    await flush();
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("onReady fires after a failed resolve too; onError gets the error", async () => {
    const onReady = vi.fn();
    const onError = vi.fn();
    const store = new Palistor({
      config: {
        wizard: defineFlow({
          steps: [
            defineStep("one", {}),
            defineStep("two", {
              data: { value: "" },
              onReady,
              resolve: { resolver: async () => { throw new Error("boom"); }, onError },
            }),
          ],
        }),
      } as any,
    });
    const flow = (store.proxy as any).wizard;

    flow.nextStep();
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(flow.loading).toBe(false);
  });

  it("onEnter / onReady get the flow's values and the store; their throws never block navigation", async () => {
    const seen: any[] = [];
    const store = new Palistor({
      config: {
        wizard: defineFlow({
          steps: [
            defineStep("one", { x: { value: 1 } }),
            defineStep("two", {
              onEnter: (values: any, s: any) => { seen.push([values.one.x, s]); throw new Error("sync"); },
              onReady: async () => { throw new Error("async"); },
            }),
            defineStep("three", {}),
          ],
        }),
      } as any,
    });
    const flow = (store.proxy as any).wizard;

    flow.nextStep();
    await flush();
    expect(seen).toEqual([[1, store]]);
    flow.nextStep();
    expect(flow.currentStepKey).toBe("three");
  });
});

// ─── 4. Hidden steps on submit, step-level validity ──────────────────────────

describe("flow — submit and validity", () => {
  function branchingStore() {
    return new Palistor({
      config: {
        top: { value: "" },
        wizard: defineFlow({
          steps: [
            defineStep("a", {
              name: { value: "", isRequired: true },
              addr: { city: { value: "", isRequired: true } },
              hidden: { value: "", isRequired: true, isVisible: () => false },
            }),
            defineStep("h", { r: { value: "", isRequired: true }, isVisible: () => false }),
          ],
        }),
      } as any,
    });
  }

  it("store.submit(): a hidden step is exempt, a hidden leaf in a visible step is not", async () => {
    const store = branchingStore();
    const result = await store.submit();
    expect(result.success === false && result.errors.map((e) => e.path)).toEqual([
      "wizard.a.name", "wizard.a.addr.city", "wizard.a.hidden",
    ]);
  });

  it("submitting a hidden step itself validates it (paths relative to the step)", async () => {
    const flow = (branchingStore().proxy as any).wizard;
    const result = await flow.steps.h.submit();
    expect(result).toEqual({ success: false, errors: [{ path: "r", message: "required" }] });
  });

  it("validate() skips hidden leaves and nested lists; step.isInvalid ignores visibility and visits", () => {
    const store = new Palistor({
      config: {
        wizard: defineFlow({
          steps: [
            defineStep("a", {
              name: { value: "", isRequired: true },
              addr: { city: { value: "", isRequired: true } },
              hidden: { value: "", isRequired: true, isVisible: () => false },
              rows: defineList({ template: { title: { value: "", isRequired: true } } as any }),
            }),
            defineStep("h", { r: { value: "", isRequired: true }, isVisible: () => false }),
          ],
        }),
      } as any,
    });
    const flow = (store.proxy as any).wizard;
    flow.steps.a.rows.add({ title: "" });

    expect(flow.validate()).toEqual([
      { path: "a.name", message: "required" },
      { path: "a.addr.city", message: "required" },
    ]);
    expect(flow.steps.h.isInvalid).toBe(true); // hidden and never visited
  });

  it("flow.submit() with errors: kept in flow.errors, leaves show theirs after", async () => {
    const flow = (branchingStore().proxy as any).wizard;
    expect(flow.steps.a.name.isInvalid).toBeFalsy(); // not validated yet

    const result = await flow.submit();

    expect(flow.errors).toBe(result.errors);
    expect(flow.revalidate).toBe(true);
    expect(flow.steps.a.name.isInvalid).toBe(true);
    expect(flow.steps.a.name.errorMessage).toBe("required");
  });

  it("flow.submit(): submitting while onSubmit runs, the result and cleared errors after", async () => {
    let finish!: (v: unknown) => void;
    const onSubmit = vi.fn((_values: unknown) => new Promise((r) => { finish = r; }));
    const store = new Palistor({
      config: {
        wizard: defineFlow({
          steps: [defineStep("a", { name: { value: "", isRequired: true } }), defineStep("b", {})],
          onSubmit,
        }),
      } as any,
    });
    const flow = (store.proxy as any).wizard;
    flow.validate();
    expect(flow.errors.length).toBe(1);
    flow.steps.a.name.value = "Ann";

    const pending = flow.submit();
    expect(flow.submitting).toBe(true);
    finish("done");
    const result = await pending;

    expect(result).toEqual({ success: true, result: "done" });
    expect(onSubmit.mock.calls[0][0]).toEqual({ a: { name: "Ann" }, b: {} });
    expect(flow.submitting).toBe(false);
    expect(flow.errors).toEqual([]);
  });
});

// ─── 5. Reset scope ──────────────────────────────────────────────────────────

describe("flow — reset scope", () => {
  it("resetting a step (or a leaf in it) keeps navigation", () => {
    const flow = (new Palistor({ config: wizardConfig() as any }).proxy as any).wizard;
    flow.nextStep();
    flow.steps.one.a.value = "x";

    flow.steps.one.reset();
    expect(flow.steps.one.a.value).toBe("");
    expect(flow.currentStepKey).toBe("two");
  });

  it("resetting a group above the flow restarts it: first step, onEnter again", () => {
    const onEnter = vi.fn();
    const store = new Palistor({
      config: {
        section: {
          wizard: defineFlow({ steps: [defineStep("one", { onEnter }), defineStep("two", {})] }),
        },
      } as any,
    });
    const section = (store.proxy as any).section;
    section.wizard.nextStep();
    expect(onEnter).toHaveBeenCalledTimes(1);

    section.reset();
    expect(section.wizard.currentStepKey).toBe("one");
    expect(section.wizard.history).toEqual(["one"]);
    expect(onEnter).toHaveBeenCalledTimes(2);
  });

  it("store.reset(values) restarts flows too; the values become the new baseline", () => {
    const store = new Palistor({ config: wizardConfig() as any });
    const flow = (store.proxy as any).wizard;
    flow.nextStep();
    flow.validate();

    // `as any`: with `config: x as any` the values type collapses to the flow node's (a public-types gap).
    store.reset({ wizard: { one: { a: "seed" } } } as any);
    expect(flow.currentStepKey).toBe("one");
    expect(flow.errors).toEqual([]);
    expect(flow.steps.one.a.value).toBe("seed");
    expect(flow.dirty).toBe(false);
  });
});

// ─── 6. Persist ──────────────────────────────────────────────────────────────

describe("flow — navigation in the persist snapshot", () => {
  const sectionConfig = (onEnter = vi.fn()) => ({
    q: { value: "" },
    sec: {
      wizard: defineFlow({
        steps: [defineStep("one", { a: { value: "" } }), defineStep("two", { onEnter }), defineStep("three", {})],
      }),
    },
  });

  it("navigation alone autosaves under __flows[path], outside pick", async () => {
    const driver = memoryDriver();
    const store = new Palistor({ config: sectionConfig() as any });
    await store.persist.enable({ key: "k", driver, debounce: 0, pick: ["q"] });

    (store.proxy as any).sec.wizard.nextStep();
    await flush();

    expect(JSON.parse(driver.data.k)).toEqual({
      q: "",
      __flows: { "sec.wizard": { currentStepKey: "two", visitStack: ["one"], visitedKeys: ["one", "two"] } },
    });
  });

  it("hydration restores navigation and enters the restored step", async () => {
    const onEnter = vi.fn();
    const driver = memoryDriver({
      k: JSON.stringify({
        q: "z",
        sec: { wizard: { one: { a: "kept" } } },
        __flows: { "sec.wizard": { currentStepKey: "two", visitStack: ["one"], visitedKeys: ["one", "two"] } },
      }),
    });
    const store = new Palistor({ config: sectionConfig(onEnter) as any });
    await store.persist.enable({ key: "k", driver, debounce: 0 });

    const wizard = (store.proxy as any).sec.wizard;
    expect(wizard.currentStepKey).toBe("two");
    expect(wizard.history).toEqual(["one", "two"]);
    expect(wizard.steps.one.status).toBe("completed");
    expect(wizard.steps.one.a.value).toBe("kept");
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect("__flows" in store.getValues()).toBe(false);
  });

  it("stale snapshots: unknown step keys are dropped, an unknown active step leaves the flow alone", async () => {
    const stale = memoryDriver({
      k: JSON.stringify({
        __flows: { "sec.wizard": { currentStepKey: "three", visitStack: ["one", "gone"], visitedKeys: ["one", "gone"] } },
      }),
    });
    const s1 = new Palistor({ config: sectionConfig() as any });
    await s1.persist.enable({ key: "k", driver: stale, debounce: 0 });
    const w1 = (s1.proxy as any).sec.wizard;
    expect(w1.currentStepKey).toBe("three");
    expect(w1.history).toEqual(["one", "three"]);
    expect(w1.steps.two.status).toBe(null);

    const unknown = memoryDriver({
      k: JSON.stringify({ __flows: { "sec.wizard": { currentStepKey: "renamed", visitStack: [], visitedKeys: [] } } }),
    });
    const s2 = new Palistor({ config: sectionConfig() as any });
    await s2.persist.enable({ key: "k", driver: unknown, debounce: 0 });
    expect((s2.proxy as any).sec.wizard.currentStepKey).toBe("one");
  });

  it("hydrating onto the step already active does not enter it again", async () => {
    const onEnter = vi.fn();
    const driver = memoryDriver({
      k: JSON.stringify({ __flows: { "sec.wizard": { currentStepKey: "one", visitStack: [], visitedKeys: ["one", "two"] } } }),
    });
    const store = new Palistor({
      config: { sec: { wizard: defineFlow({ steps: [defineStep("one", { onEnter }), defineStep("two", {})] }) } } as any,
    });
    expect(onEnter).toHaveBeenCalledTimes(1); // construction
    await store.persist.enable({ key: "k", driver, debounce: 0 });
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect((store.proxy as any).sec.wizard.steps.two.status).toBe("completed");
  });
});

// ─── 7. fieldMapping ─────────────────────────────────────────────────────────

describe("flow — fieldMapping", () => {
  const mapping = { dirty: "isDirty", loading: "isLoading", isInvalid: "error" } as const;

  it("flow and step nodes answer the external names; navigation keys are not mapped", () => {
    const store = new Palistor({ config: wizardConfig() as any, fieldMapping: mapping as any });
    const flow = (store.proxy as any).wizard;

    const keys = Object.keys(flow);
    expect(keys).toContain("isDirty");
    expect(keys).toContain("isLoading");
    expect(keys).not.toContain("dirty");
    expect(keys).toContain("currentStepKey");
    expect(keys).toContain("errors");
    expect(Object.keys(flow.steps.one)).toContain("isDirty");

    expect(flow.error).toBe(true); // aggregate validity of the visited steps
    expect(flow.steps.one.error).toBe(true);
    expect(flow.steps.two.error).toBe(false);
    expect(flow.isLoading).toBe(false);

    flow.steps.one.a.value = "ok";
    expect(flow.isDirty).toBe(true);
    expect(flow.dirty).toBe(true); // the internal name stays readable
    expect(flow.error).toBe(false);
  });

  it("useForm re-renders on the mapped composite loading", async () => {
    let finish!: (v: unknown) => void;
    const store = new Palistor({
      config: {
        wizard: defineFlow({
          steps: [
            defineStep("one", {}),
            defineStep("two", {
              data: { value: "" },
              resolve: { resolver: () => new Promise((r) => { finish = r; }), onError: () => {} },
            }),
          ],
        }),
      } as any,
      fieldMapping: mapping as any,
    });
    const flow = (store.proxy as any).wizard;

    function Loading() {
      const form = useForm(store) as any;
      return <span data-testid="l">{form.wizard.isLoading ? "loading" : "idle"}</span>;
    }
    const { getByTestId } = render(<Loading />);
    act(() => flow.nextStep());
    expect(getByTestId("l").textContent).toBe("loading");
    await act(async () => { finish({ data: "x" }); await flush(); });
    expect(getByTestId("l").textContent).toBe("idle");
  });
});
