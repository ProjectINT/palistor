/**
 * Contract (slice J, Phase 2.8): the lazy trigger and Suspense on a group
 * resolve, through the public node. Replaces store's unit test
 * `buildProxy/handleLazyResolve.test.ts` (it called the trap helper with fake
 * resolve states) with the same rules read off a real store:
 *  - the first read starts a lazy resolve on the next microtask, never inside
 *    the read; reads while it runs start nothing;
 *  - `options.suspense`: while the run is pending, reading the group's
 *    children, value, label or flags throws the run's promise; its own state
 *    (loading, values, dirty, …) and methods never throw;
 *  - the thrown promise settles when the run lands and never rejects; errors
 *    are never thrown.
 *
 * Runs in both vitest projects: `store` proves the test itself is right,
 * `cube` shows parity. Imports only from "@impl".
 */

import { describe, it, expect, vi } from "vitest";
import { Palistor } from "@impl";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function deferred<T = unknown>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** What a read threw, or NONE. */
const NONE = Symbol("none");
function thrown(read: () => unknown): unknown {
  try { read(); } catch (e) { return e; }
  return NONE;
}

/** A store whose `car` group resolves through a controllable promise. */
function carStore(opts: { suspense?: boolean; optimistic?: boolean; extra?: Record<string, unknown> } = {}) {
  const runs: Array<ReturnType<typeof deferred<any>>> = [];
  const resolver = vi.fn((_values: any) => {
    const d = deferred<any>();
    runs.push(d);
    return d.promise;
  });
  const store = new Palistor({
    config: {
      userId: { value: "u1" },
      car: {
        resolve: {
          resolver,
          onError: vi.fn(),
          ...(opts.optimistic ? { optimisticResolver: () => ({ brand: "…" }) } : {}),
          ...(opts.suspense === undefined ? {} : { options: { suspense: opts.suspense } }),
        },
        brand: { value: "" },
        engine: { power: { value: 0 } },
        ...opts.extra,
      },
      other: { name: { value: "n" } },
    } as any,
  });
  const proxy = store.proxy as any;
  return { store, proxy, car: proxy.car, resolver, runs };
}

/** First read, then the microtask that starts the run. */
async function startRun(car: any) {
  void thrown(() => car.brand);
  await Promise.resolve();
}

describe("lazy trigger", () => {
  it("the first read does not call the resolver synchronously; the next microtask does", async () => {
    const { car, resolver } = carStore();
    void car.brand.value;
    expect(resolver).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("reads while the run is pending start nothing", async () => {
    const { car, resolver, runs } = carStore();
    await startRun(car);
    void car.brand.value;
    void car.label;
    void car.engine.power.value;
    await flush();
    expect(resolver).toHaveBeenCalledTimes(1);
    runs[0].resolve({ brand: "Toyota" });
    await flush();
    void car.brand.value;
    await flush();
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("a group without a resolve config is unaffected by a resolving sibling", async () => {
    const { proxy, car } = carStore({ suspense: true });
    await startRun(car);
    expect(thrown(() => proxy.other.name.value)).toBe(NONE);
    expect(proxy.other.name.value).toBe("n");
  });
});

describe("suspense: true", () => {
  it("the first read (resolve idle) does not throw", () => {
    const { car } = carStore({ suspense: true });
    expect(thrown(() => car.brand)).toBe(NONE);
  });

  it("while pending, children, value, label and flags throw the run's promise", async () => {
    const { car } = carStore({ suspense: true });
    await startRun(car);
    const first = thrown(() => car.brand);
    expect(first).toBeInstanceOf(Promise);
    for (const key of ["brand", "engine", "value", "label", "isVisible", "isInvalid", "isRequired", "isDisabled", "isReadOnly", "errorMessage"]) {
      expect(thrown(() => car[key]), key).toBe(first);
    }
  });

  it("while pending, the group's own state and methods do not throw", async () => {
    const { car } = carStore({ suspense: true });
    await startRun(car);
    for (const key of ["loading", "values", "dirty", "submitting", "revalidate", "submit", "reset", "setValues", "onValueChange"]) {
      expect(thrown(() => car[key]), key).toBe(NONE);
    }
    expect(car.loading).toBe(true);
  });

  it("the thrown promise settles when the run lands; then reads return the result", async () => {
    const { car, runs } = carStore({ suspense: true });
    await startRun(car);
    const p = thrown(() => car.brand) as Promise<unknown>;
    runs[0].resolve({ brand: "Toyota" });
    await p;
    await flush();
    expect(thrown(() => car.brand)).toBe(NONE);
    expect(car.brand.value).toBe("Toyota");
    expect(car.loading).toBe(false);
  });

  it("a nested group inside the suspended one is reachable once the run lands", async () => {
    const { car, runs } = carStore({ suspense: true });
    await startRun(car);
    expect(thrown(() => car.engine)).toBeInstanceOf(Promise);
    runs[0].resolve({ engine: { power: 150 } });
    await flush();
    expect(car.engine.power.value).toBe(150);
  });

  it("a resolver error: the promise resolves (never rejects), reads stop throwing, the error is not thrown", async () => {
    const { car, runs } = carStore({ suspense: true });
    await startRun(car);
    const p = thrown(() => car.brand) as Promise<unknown>;
    let outcome = "pending";
    p.then(() => { outcome = "resolved"; }, () => { outcome = "rejected"; });
    runs[0].reject(new Error("boom"));
    await flush();
    expect(outcome).toBe("resolved");
    expect(thrown(() => car.brand)).toBe(NONE);
    expect(car.brand.value).toBe("");
    expect(car.loading).toBe(false);
  });

  it("with retry, the promise settles only after the last attempt", async () => {
    let n = 0;
    const store = new Palistor({
      config: {
        car: {
          resolve: {
            resolver: vi.fn(async () => { n++; if (n < 3) throw new Error(`fail ${n}`); return { brand: "Third" }; }),
            onError: vi.fn(),
            options: { suspense: true, retry: { attempts: 2, delay: 10 } },
          },
          brand: { value: "" },
        },
      } as any,
    });
    const car = (store.proxy as any).car;
    await startRun(car);
    const p = thrown(() => car.brand) as Promise<unknown>;
    let settled = false;
    void p.then(() => { settled = true; });
    await delay(5);
    expect(settled).toBe(false);
    expect(thrown(() => car.brand)).toBe(p);
    await delay(40);
    expect(settled).toBe(true);
    expect(car.brand.value).toBe("Third");
  });

  it("an optimisticResolver does not cancel suspense", async () => {
    const { car, runs } = carStore({ suspense: true, optimistic: true });
    await startRun(car);
    expect(thrown(() => car.brand)).toBeInstanceOf(Promise);
    runs[0].resolve({ brand: "Real" });
    await flush();
    expect(car.brand.value).toBe("Real");
  });

  it("a dependency change in flight: after the first promise settles, a read throws the next run's promise", async () => {
    const runs: Array<ReturnType<typeof deferred<any>>> = [];
    const seen: string[] = [];
    const store = new Palistor({
      config: {
        userId: { value: "a" },
        car: {
          resolve: {
            resolver: vi.fn((values: any) => { seen.push(values.userId); const d = deferred<any>(); runs.push(d); return d.promise; }),
            onError: vi.fn(),
            options: { suspense: true },
          },
          brand: { value: "" },
        },
      } as any,
    });
    const proxy = store.proxy as any;
    await startRun(proxy.car);
    const p1 = thrown(() => proxy.car.brand) as Promise<unknown>;
    proxy.userId.value = "b";
    await flush();
    runs[0].resolve({ brand: "A" });
    await p1;
    await flush();
    const p2 = thrown(() => proxy.car.brand);
    expect(p2).toBeInstanceOf(Promise);
    expect(p2).not.toBe(p1);
    expect(seen).toEqual(["a", "b"]);
    runs[1].resolve({ brand: "B" });
    await flush();
    expect(proxy.car.brand.value).toBe("B");
  });

  it("a resolve on the root group suspends reads of its children", async () => {
    const d = deferred<any>();
    const store = new Palistor({
      config: {
        name: { value: "" },
        resolve: { resolver: () => d.promise, onError: vi.fn(), options: { suspense: true } },
      } as any,
    });
    const proxy = store.proxy as any;
    void thrown(() => proxy.name);
    await Promise.resolve();
    expect(thrown(() => proxy.name)).toBeInstanceOf(Promise);
    d.resolve({ name: "Root" });
    await flush();
    expect(proxy.name.value).toBe("Root");
  });
});

describe("suspense off", () => {
  it.each([["by default", undefined], ["suspense: false", false]] as const)("%s, reads while pending do not throw", async (_label, suspense) => {
    const { car } = carStore({ suspense });
    await startRun(car);
    expect(car.loading).toBe(true);
    expect(thrown(() => car.brand.value)).toBe(NONE);
    expect(thrown(() => car.label)).toBe(NONE);
  });

  it("an entity field resolve never suspends, whatever its options (only groups and lists do)", async () => {
    const d = deferred<any>();
    const store = new Palistor({
      config: { users: [{ name: { value: "" }, extra: { value: "", resolve: { resolver: () => d.promise, options: { suspense: true } } } }] } as any,
    });
    store.set([{ id: "u1", name: "A", extra: "" }]);
    const users = (store.proxy as any).users;
    users.add("u1");
    void users.items[0].extra.value;
    await flush();
    expect(users.items[0].extra.loading).toBe(true);
    expect(thrown(() => users.items[0].extra.value)).toBe(NONE);
    d.resolve("x");
    await flush();
    expect(users.items[0].extra.value).toBe("x");
  });
});
