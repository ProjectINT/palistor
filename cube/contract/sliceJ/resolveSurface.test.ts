/**
 * Contract (slice J, Phase 2.8): resolve behavior store implemented but never
 * tested — retry timing and state, a list resolve ignoring `retry` and
 * `optimisticResolver` (its types do not have them), a chain of resolves,
 * and the restart cap stopping a cycle between two resolvers.
 *
 * Runs in both vitest projects: `store` proves the test itself is right,
 * `cube` shows parity. Imports only from "@impl".
 */

import { describe, it, expect, vi } from "vitest";
import { Palistor, defineList } from "@impl";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("retry", () => {
  it("loading stays true across attempts; onError gets the last error and notify, once", async () => {
    let n = 0;
    const onError = vi.fn();
    const store = new Palistor({
      config: {
        car: {
          resolve: {
            resolver: vi.fn(async () => { n++; throw new Error(`fail ${n}`); }),
            onError,
            options: { retry: { attempts: 2, delay: 20 } },
          },
          brand: { value: "" },
        },
      } as any,
    });
    const car = (store.proxy as any).car;
    void car.brand.value;
    await flush();
    expect([car.loading, n]).toEqual([true, 1]);
    await delay(30);
    expect([car.loading, n]).toEqual([true, 2]);
    expect(onError).not.toHaveBeenCalled();
    await delay(40);
    expect([car.loading, n]).toEqual([false, 3]);
    expect(onError).toHaveBeenCalledTimes(1);
    const [error, ctx] = onError.mock.calls[0];
    expect((error as Error).message).toBe("fail 3");
    expect(typeof ctx.notify).toBe("function");
  });

  it("the default delay is 1000 ms", async () => {
    vi.useFakeTimers();
    try {
      const resolver = vi.fn(async () => { throw new Error("x"); });
      const store = new Palistor({
        config: { car: { resolve: { resolver, onError: vi.fn(), options: { retry: { attempts: 1 } } }, brand: { value: "" } } } as any,
      });
      void (store.proxy as any).car.brand.value;
      await vi.advanceTimersByTimeAsync(0);
      expect(resolver).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(999);
      expect(resolver).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(resolver).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("an attempt after a dependency change reads the current values", async () => {
    const seen: string[] = [];
    const store = new Palistor({
      config: {
        userId: { value: "a" },
        car: {
          resolve: {
            resolver: vi.fn(async (values: any) => {
              seen.push(values.userId);
              if (values.userId === "a") throw new Error("x");
              return { brand: values.userId };
            }),
            onError: vi.fn(),
            options: { retry: { attempts: 3, delay: 20 } },
          },
          brand: { value: "" },
        },
      } as any,
    });
    const proxy = store.proxy as any;
    void proxy.car.brand.value;
    await flush();
    proxy.userId.value = "b";
    await delay(60);
    expect(seen).toEqual(["a", "b"]);
    expect(proxy.car.brand.value).toBe("b");
  });
});

describe("list resolve", () => {
  it("ignores options.retry and optimisticResolver (list.reload() is the retry)", async () => {
    const resolver = vi.fn(async () => { throw new Error("down"); });
    const optimisticResolver = vi.fn(() => [{ id: "o1", name: "placeholder" }]);
    const users = defineList<{ id: string; name: string }>({
      template: { id: { value: "" }, name: { value: "" } },
      resolve: { resolver, optimisticResolver, options: { retry: { attempts: 2, delay: 5 } } } as any,
    });
    const store = new Palistor({ config: { users } as any });
    const list = (store.proxy as any).users;
    void list.items;
    await delay(40);
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(optimisticResolver).not.toHaveBeenCalled();
    expect(list.length).toBe(0);
    expect((list.error as Error).message).toBe("down");
    list.reload();
    await flush();
    expect(resolver).toHaveBeenCalledTimes(2);
  });
});

describe("restarts", () => {
  it("a chain: a resolve reading another's result re-runs once after it, per change", async () => {
    const ra = vi.fn(async (values: any) => ({ x: `${values.userId}-x` }));
    const rb = vi.fn(async (values: any) => ({ y: `${values.a.x}-y` }));
    const store = new Palistor({
      config: {
        userId: { value: "u1" },
        a: { resolve: { resolver: ra, onError: vi.fn(), options: { lazy: false } }, x: { value: "" } },
        b: { resolve: { resolver: rb, onError: vi.fn(), options: { lazy: false } }, y: { value: "" } },
      } as any,
    });
    const proxy = store.proxy as any;
    for (let i = 0; i < 5; i++) await flush();
    expect(proxy.b.y.value).toBe("u1-x-y");
    const [a0, b0] = [ra.mock.calls.length, rb.mock.calls.length];
    proxy.userId.value = "u2";
    for (let i = 0; i < 5; i++) await flush();
    expect(proxy.b.y.value).toBe("u2-x-y");
    expect(ra.mock.calls.length - a0).toBe(1);
    expect(rb.mock.calls.length - b0).toBe(1);
  });

  it("a cycle between two resolvers stops with a warning; the store keeps working", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const ra = vi.fn(async (values: any) => ({ x: (values.b.y ?? 0) + 1 }));
      const rb = vi.fn(async (values: any) => ({ y: (values.a.x ?? 0) + 1 }));
      const store = new Palistor({
        config: {
          a: { resolve: { resolver: ra, onError: vi.fn(), options: { lazy: false } }, x: { value: 0 } },
          b: { resolve: { resolver: rb, onError: vi.fn(), options: { lazy: false } }, y: { value: 0 } },
          note: { value: "" },
        } as any,
      });
      for (let i = 0; i < 150; i++) await flush();
      const calls = ra.mock.calls.length + rb.mock.calls.length;
      for (let i = 0; i < 50; i++) await flush();
      expect(ra.mock.calls.length + rb.mock.calls.length).toBe(calls); // stopped
      expect(calls).toBeGreaterThan(10);
      expect(calls).toBeLessThan(100);
      expect(warn).toHaveBeenCalled();
      const proxy = store.proxy as any;
      proxy.note.value = "still works";
      expect(proxy.note.value).toBe("still works");
      expect(proxy.a.loading).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });
});
