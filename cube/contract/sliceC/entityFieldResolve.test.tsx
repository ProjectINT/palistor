/**
 * Per-entity field resolve: a template leaf with `resolve` runs once per
 * entity, lazily, when a component first reads the field.
 *
 * Replaces three kernel-level files of store/: resolvePipeline/
 * executeEntityFieldResolve.test.ts (the executor with hand-made deps),
 * init/createResolveManager.entityField.test.ts (the manager's dispatch and
 * skipIfResolved over a fake registry) and init/createResolveManager.phase4.test.ts
 * (lifecycle through `resolveManager.triggerEntityFieldResolve` and
 * `entityStates`). The same rules, through the public surface: the lazy
 * trigger is a read of `field.value` / `field.loading` on a list item or on a
 * useForm(entity, template) form.
 *
 *  - the resolver gets the entity's values and the store; the result lands in the row
 *  - loading lifecycle; undefined results don't overwrite
 *  - skipIfResolved: a non-default row value skips the run (null / undefined / default don't)
 *  - auto-deps: an entity field the resolver read changes → re-run; dep change while pending → re-run after
 *  - error path with onError, retry
 *  - list resolve never triggers field resolves eagerly; store.set doesn't either
 *  - store.delete clears the state; store.reset() clears it so the next read re-runs
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { Palistor, useForm } from "@impl";
import { CONFIG_NODE, LIST_STATE } from "../../../store/constants";

/**
 * Contract shim: store keys subscriptions and versions by its internal objects
 * (the ListState of a list, the entity leaf node of a field), cube by the
 * public node itself. Both implementations answer the same key through this.
 */
const trackKey = (node: any): object => node[LIST_STATE] ?? node[CONFIG_NODE] ?? node;

async function flushPromises(times = 3) {
  for (let i = 0; i < times; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

/** The lazy trigger fires on the next microtask after the first read. */
async function readAndFlush(read: () => unknown) {
  read();
  await flushPromises();
}

function makeFieldStore(opts: {
  resolver?: (...a: any[]) => Promise<unknown>;
  onError?: (...a: any[]) => void;
  options?: Record<string, unknown>;
  deps?: string[];
  rows?: Array<Record<string, unknown>>;
} = {}) {
  const resolve = {
    resolver: vi.fn(opts.resolver ?? (async () => true)),
    onError: vi.fn(opts.onError ?? (() => {})),
    ...(opts.options ? { options: opts.options } : {}),
    ...(opts.deps ? { deps: opts.deps } : {}),
  };
  const template = {
    id: { value: "" },
    name: { value: "" },
    isActive: { value: false, resolve },
  };
  const store = new Palistor({ config: { users: [template] } as any });
  const rows = opts.rows ?? [{ id: "u1", name: "Alice", isActive: false }];
  store.set(rows);
  for (const r of rows) (store.proxy as any).users.add(r.id);
  const field = (index = 0) => (store.proxy as any).users.items[index].isActive;
  return { store, template, resolve, field };
}

// ─── Execution ────────────────────────────────────────────────────────────────

describe("entity field resolve — execution", () => {
  it("resolver is called with the entity values (flat) and the store", async () => {
    // The values are read inside the resolver: store hands a snapshot, cube live getters.
    // Only foreign keys are read: a resolver that reads the field it writes
    // re-runs forever on store (its entity retrigger has no cap).
    const seen: any[] = [];
    const { store, resolve, field } = makeFieldStore({
      resolver: async (values: any, s: any) => { seen.push({ id: values.id, name: values.name, store: s }); return true; },
    });

    await readAndFlush(() => field().value);

    expect(resolve.resolver).toHaveBeenCalledTimes(1);
    const { id, name, store: calledStore } = seen[0];
    expect(id).toBe("u1");
    expect(name).toBe("Alice");
    expect(calledStore.context).toEqual(store.context);
    expect(field().value).toBe(true);
  });

  it("the resolved value is written to the entity and read through the field", async () => {
    const { store, field } = makeFieldStore({ resolver: async () => true });

    await readAndFlush(() => field().value);

    expect(field().value).toBe(true);
    expect((store.entityRegistry.get("u1") as any).isActive === true || (store.entityRegistry.get("u1") as any).isActive?.value === true).toBe(true);
    expect((store.proxy as any).users.getValues()).toEqual([{ id: "u1", name: "Alice", isActive: true }]);
  });

  it("the resolved value is the dirty baseline", async () => {
    const { field } = makeFieldStore({ resolver: async () => true });
    await readAndFlush(() => field().value);
    expect(field().dirty).toBe(false);
  });

  it("an undefined result does NOT overwrite the entity field", async () => {
    const { field } = makeFieldStore({ resolver: async () => undefined });
    await readAndFlush(() => field().value);
    expect(field().value).toBe(false);
  });

  it("loading = true while running, false after; reading loading triggers too", async () => {
    let resolveIt!: (v: unknown) => void;
    const { field } = makeFieldStore({ resolver: () => new Promise((r) => { resolveIt = r; }) });

    expect(field().loading).toBe(false); // the read schedules the run
    await Promise.resolve();
    expect(field().loading).toBe(true);

    resolveIt(true);
    await flushPromises();
    expect(field().loading).toBe(false);
    expect(field().value).toBe(true);
  });

  it("notifies global subscribers when the run starts and when it completes", async () => {
    let resolveIt!: (v: unknown) => void;
    const { store, field } = makeFieldStore({ resolver: () => new Promise((r) => { resolveIt = r; }) });
    const listener = vi.fn();
    store.subscribeGlobal(listener);

    void field().value;
    await Promise.resolve();
    expect(listener.mock.calls.length).toBeGreaterThan(0);
    const afterStart = listener.mock.calls.length;

    resolveIt(true);
    await flushPromises();
    expect(listener.mock.calls.length).toBeGreaterThan(afterStart);
  });

  it("the field's subscriber is notified when the result lands", async () => {
    const { store, field } = makeFieldStore({ resolver: async () => true });
    const listener = vi.fn();
    store.subscribe(trackKey(field()), listener);

    await readAndFlush(() => field().value);

    expect(listener).toHaveBeenCalled();
  });

  it("deduplication: repeated reads while pending run the resolver once", async () => {
    let resolveIt!: (v: unknown) => void;
    const { resolve, field } = makeFieldStore({ resolver: () => new Promise((r) => { resolveIt = r; }) });

    void field().value;
    void field().loading;
    await Promise.resolve();
    void field().value;
    await Promise.resolve();

    expect(resolve.resolver).toHaveBeenCalledTimes(1);
    resolveIt(true);
    await flushPromises();
  });

  it("resolves run independently per entity", async () => {
    const { resolve, field } = makeFieldStore({
      rows: [{ id: "u1", name: "Alice", isActive: false }, { id: "u2", name: "Bob", isActive: false }],
      resolver: async (v: any) => v.name === "Alice",
    });

    await readAndFlush(() => { void field(0).value; void field(1).value; });

    expect(resolve.resolver).toHaveBeenCalledTimes(2);
    expect(field(0).value).toBe(true);
    expect(field(1).value).toBe(false);
  });
});

// ─── skipIfResolved ───────────────────────────────────────────────────────────

describe("entity field resolve — skipIfResolved", () => {
  it("skips when the entity already has a non-default value (default: true)", async () => {
    const { resolve, field } = makeFieldStore({ rows: [{ id: "u1", isActive: true }] });
    await readAndFlush(() => field().value);
    expect(resolve.resolver).not.toHaveBeenCalled();
    expect(field().loading).toBe(false);
    expect(field().value).toBe(true);
  });

  it("does NOT skip when the value equals the template default", async () => {
    const { resolve, field } = makeFieldStore({ rows: [{ id: "u1", isActive: false }] });
    await readAndFlush(() => field().value);
    expect(resolve.resolver).toHaveBeenCalledTimes(1);
  });

  it("does NOT skip when the value is null", async () => {
    const { resolve, field } = makeFieldStore({ rows: [{ id: "u1", isActive: null }] });
    await readAndFlush(() => field().value);
    expect(resolve.resolver).toHaveBeenCalledTimes(1);
  });

  it("does NOT skip when the field is absent from the entity", async () => {
    const { resolve, field } = makeFieldStore({ rows: [{ id: "u1", name: "Alice" }] });
    await readAndFlush(() => field().value);
    expect(resolve.resolver).toHaveBeenCalledTimes(1);
    expect(field().value).toBe(true); // the result created the field
  });

  it("runs with skipIfResolved: false even when the value is non-default", async () => {
    const { resolve, field } = makeFieldStore({ rows: [{ id: "u1", isActive: true }], options: { skipIfResolved: false }, resolver: async () => false });
    await readAndFlush(() => field().value);
    expect(resolve.resolver).toHaveBeenCalledTimes(1);
    expect(field().value).toBe(false);
  });
});

// ─── Dependencies ─────────────────────────────────────────────────────────────

describe("entity field resolve — dependencies", () => {
  it("an entity field the resolver read changes (store.set) → the resolve re-runs", async () => {
    const seen: string[] = [];
    const { store, field } = makeFieldStore({
      resolver: async (v: any) => { seen.push(v.name); return v.name === "Alice"; },
    });

    await readAndFlush(() => field().value);
    expect(seen).toEqual(["Alice"]);
    expect(field().value).toBe(true);

    store.set({ id: "u1", name: "Bob" });
    await flushPromises();

    expect(seen).toEqual(["Alice", "Bob"]);
    expect(field().value).toBe(false);
  });

  it("an entity field the resolver did NOT read changes → no re-run", async () => {
    const { store, resolve, field } = makeFieldStore({ rows: [{ id: "u1", name: "Alice", isActive: false, other: "x" }] });
    await readAndFlush(() => field().value);
    store.set({ id: "u1", other: "y" });
    await flushPromises();
    expect(resolve.resolver).toHaveBeenCalledTimes(1);
  });

  it("explicit deps re-run the resolve even before an auto-dep was read", async () => {
    const { store, resolve, field } = makeFieldStore({ deps: ["name"], resolver: async () => true });
    await readAndFlush(() => field().value);
    store.set({ id: "u1", name: "Bob" });
    await flushPromises();
    expect(resolve.resolver).toHaveBeenCalledTimes(2);
  });

  it("a dep change while pending → one more run after completion", async () => {
    let resolveFirst!: (v: unknown) => void;
    let calls = 0;
    const { store, field } = makeFieldStore({
      deps: ["name"],
      resolver: (v: any) => {
        calls++;
        void v.name;
        return calls === 1 ? new Promise((r) => { resolveFirst = r; }) : Promise.resolve(v.name === "Bob");
      },
    });

    void field().value;
    await Promise.resolve();
    expect(calls).toBe(1);

    store.set({ id: "u1", name: "Bob" }); // while pending
    await Promise.resolve();
    expect(calls).toBe(1);

    resolveFirst(false);
    await flushPromises();

    expect(calls).toBe(2);
    expect(field().value).toBe(true);
  });

});

// ─── Errors and retry ─────────────────────────────────────────────────────────

describe("entity field resolve — errors and retry", () => {
  it("onError is called with the error and notify; loading false; value untouched", async () => {
    const error = new Error("resolve failed");
    const notify = vi.fn();
    const { store, resolve, field } = makeFieldStore({ resolver: async () => { throw error; } });
    store.setNotifier(notify);

    await readAndFlush(() => field().value);

    expect(resolve.onError).toHaveBeenCalledTimes(1);
    const [err, ctx] = resolve.onError.mock.calls[0] as any[];
    expect(err).toBe(error);
    ctx.notify("boom");
    expect(notify).toHaveBeenCalledWith("boom");
    expect(field().loading).toBe(false);
    expect(field().value).toBe(false);
  });


  it("retries up to options.retry.attempts, then succeeds", async () => {
    const resolver = vi.fn()
      .mockRejectedValueOnce(new Error("attempt 1 fail"))
      .mockRejectedValueOnce(new Error("attempt 2 fail"))
      .mockResolvedValue(true);
    const { resolve, field } = makeFieldStore({ resolver, options: { retry: { attempts: 2, delay: 0 } } });

    await readAndFlush(() => field().value);
    await flushPromises(10);

    expect(resolver).toHaveBeenCalledTimes(3);
    expect(resolve.onError).not.toHaveBeenCalled();
    expect(field().value).toBe(true);
  });

  it("onError once after every retry failed", async () => {
    const resolver = vi.fn().mockRejectedValue(new Error("always fails"));
    const { resolve, field } = makeFieldStore({ resolver, options: { retry: { attempts: 1, delay: 0 } } });

    await readAndFlush(() => field().value);
    await flushPromises(10);

    expect(resolver).toHaveBeenCalledTimes(2);
    expect(resolve.onError).toHaveBeenCalledTimes(1);
    expect(field().loading).toBe(false);
  });
});

// ─── Lifecycle (phase 4) ──────────────────────────────────────────────────────

describe("entity field resolve — lifecycle", () => {
  function makeListStore(fieldResolver: (...args: any[]) => Promise<unknown> = async () => true, lazy = false) {
    const fieldResolve = { resolver: vi.fn(fieldResolver), onError: vi.fn() };
    const template = {
      id: { value: "" },
      name: { value: "" },
      isActive: { value: false, resolve: fieldResolve },
    };
    const listResolver = vi.fn(async () => [{ id: "u1", name: "Alice", isActive: false }, { id: "u2", name: "Bob", isActive: false }]);
    const store = new Palistor({
      config: {
        users: [template, { resolve: { resolver: listResolver, onError: vi.fn(), options: { lazy } } }],
      } as any,
    });
    return { store, template, fieldResolve, listResolver };
  }

  it("the list resolver loads entities without triggering field resolves (lazy-only)", async () => {
    const { store, fieldResolve } = makeListStore();
    await flushPromises(5);
    expect((store.proxy as any).users.length).toBe(2);
    expect(fieldResolve.resolver).not.toHaveBeenCalled();
  });

  it("reading a field after the list loaded triggers its resolve, per entity", async () => {
    const { store, fieldResolve } = makeListStore();
    await flushPromises(5);

    await readAndFlush(() => (store.proxy as any).users.items[0].isActive.value);
    expect(fieldResolve.resolver).toHaveBeenCalledTimes(1);
    expect(fieldResolve.resolver.mock.calls[0][0]).toMatchObject({ id: "u1", name: "Alice" });
    expect((store.proxy as any).users.items[0].isActive.value).toBe(true);
    expect((store.proxy as any).users.items[1].isActive.value).toBe(false); // u2 not read yet → not resolved

    await flushPromises();
    expect(fieldResolve.resolver).toHaveBeenCalledTimes(2); // that read triggered u2
  });

  it("store.set() alone does not trigger field resolves", async () => {
    const { store, fieldResolve } = makeListStore(async () => true, true);
    store.set({ id: "u3", name: "Carol", isActive: false });
    await flushPromises();
    expect(fieldResolve.resolver).not.toHaveBeenCalled();
    expect((store.proxy as any).users.length).toBe(0);
  });

  it("store.delete() clears the entity's resolve state: a re-added entity resolves again", async () => {
    const { store, fieldResolve } = makeListStore();
    await flushPromises(5);
    await readAndFlush(() => (store.proxy as any).users.items[0].isActive.value);
    expect(fieldResolve.resolver).toHaveBeenCalledTimes(1);

    store.delete("u1");
    expect((store.proxy as any).users.length).toBe(1);

    store.set({ id: "u1", name: "Alice", isActive: false });
    (store.proxy as any).users.add("u1");
    await readAndFlush(() => (store.proxy as any).users.getById("u1").isActive.value);
    expect(fieldResolve.resolver).toHaveBeenCalledTimes(2);
  });

  it("the same entity through useForm(entity, template) and the list shares one resolve", async () => {
    const fieldResolve = { resolver: vi.fn(async () => true), onError: vi.fn(), options: { skipIfResolved: false } };
    const template = { id: { value: "" }, name: { value: "" }, isActive: { value: false, resolve: fieldResolve } };
    const store = new Palistor({ config: { users: [template], editUserForm: template } as any });
    store.set({ id: "u1", name: "Alice", isActive: false });
    (store.proxy as any).users.add("u1");

    const { result } = renderHook(() => useForm((store.proxy as any).users.items[0], (s: any) => s.editUserForm));
    await act(async () => {
      void (result.current as any).isActive.value;
      void (store.proxy as any).users.items[0].isActive.value;
      await flushPromises();
    });

    expect(fieldResolve.resolver).toHaveBeenCalledTimes(1);
    expect((result.current as any).isActive.value).toBe(true);
    expect((store.proxy as any).users.items[0].isActive.value).toBe(true);
  });

  it("store.reset() clears the field resolve states: the next read re-runs, nothing runs by itself", async () => {
    const { store, fieldResolve } = makeListStore();
    await flushPromises(5);
    await readAndFlush(() => (store.proxy as any).users.items[0].isActive.value);
    expect(fieldResolve.resolver).toHaveBeenCalledTimes(1);

    store.reset();
    await flushPromises();
    // Field resolver was only called once (during the first read, not during reset)
    expect(fieldResolve.resolver).toHaveBeenCalledTimes(1);

    // The resolved value is the baseline, so skipIfResolved would skip: force a run with a default value.
    store.set({ id: "u1", isActive: false });
    await readAndFlush(() => (store.proxy as any).users.items[0].isActive.value);
    expect(fieldResolve.resolver).toHaveBeenCalledTimes(2);
  });

  it("reset() of a subgroup does not clear entity resolve states", async () => {
    const fieldResolve = { resolver: vi.fn(async () => true), onError: vi.fn() };
    const store = new Palistor({
      config: {
        section: { title: { value: "" } },
        users: [{ id: { value: "" }, isActive: { value: false, resolve: fieldResolve } }],
      } as any,
    });
    store.set({ id: "u1", isActive: false });
    (store.proxy as any).users.add("u1");
    await readAndFlush(() => (store.proxy as any).users.items[0].isActive.value);
    expect(fieldResolve.resolver).toHaveBeenCalledTimes(1);

    (store.proxy as any).section.reset();
    store.set({ id: "u1", isActive: false });
    await readAndFlush(() => (store.proxy as any).users.items[0].isActive.value);
    expect(fieldResolve.resolver).toHaveBeenCalledTimes(1); // still resolved
  });
});
