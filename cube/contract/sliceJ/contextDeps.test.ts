/**
 * Contract (slice J, Phase 2.8): `resolve.contextDeps` — a group resolve does
 * not start until every listed `store.context` key is non-null; setContext
 * starts it. store queued the entry (status idle) and flushed the queue on
 * setContext; nothing tested it. palirent relies on it (the vehicle form's
 * root resolve waits for `vehicleSlug` and `accountId`, the user search for
 * `accountId`).
 *
 * Runs in both vitest projects: `store` proves the test itself is right,
 * `cube` shows parity. Imports only from "@impl".
 */

import { describe, it, expect, vi } from "vitest";
import { Palistor } from "@impl";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function groupStore(opts: { contextDeps: string[]; lazy?: boolean; suspense?: boolean; context?: Record<string, unknown> }) {
  const resolver = vi.fn(async (_values: any, store: any) => ({ brand: `brand-${store.context.accountId ?? "?"}` }));
  const store = new Palistor({
    config: {
      car: {
        resolve: {
          resolver,
          onError: vi.fn(),
          contextDeps: opts.contextDeps,
          options: { lazy: opts.lazy ?? true, suspense: opts.suspense ?? false },
        },
        brand: { value: "" },
      },
    } as any,
    ...(opts.context ? { context: opts.context } : {}),
  });
  return { store, resolver, car: (store.proxy as any).car };
}

describe("contextDeps", () => {
  it("a lazy resolve read before the key is set does not run, and stays idle (loading false)", async () => {
    const { car, resolver } = groupStore({ contextDeps: ["accountId"] });
    void car.brand.value;
    await flush();
    void car.brand.value;
    await flush();
    expect(resolver).not.toHaveBeenCalled();
    expect(car.loading).toBe(false);
    expect(car.brand.value).toBe("");
  });

  it("setContext with the key starts the run right away and it lands", async () => {
    const { store, car, resolver } = groupStore({ contextDeps: ["accountId"] });
    void car.brand.value;
    await flush();
    store.setContext({ accountId: "acc1" });
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(car.loading).toBe(true);
    await flush();
    expect(car.loading).toBe(false);
    expect(car.brand.value).toBe("brand-acc1");
  });

  it("an unrelated key, or the key set to null / undefined, does not start it", async () => {
    const { store, car, resolver } = groupStore({ contextDeps: ["accountId"] });
    void car.brand.value;
    await flush();
    store.setContext({ other: 1 });
    store.setContext({ accountId: null });
    store.setContext({ accountId: undefined });
    await flush();
    expect(resolver).not.toHaveBeenCalled();
    store.setContext({ accountId: 0 }); // non-null is enough
    await flush();
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("every listed key is required", async () => {
    const resolver = vi.fn(async () => ({ name: "N" }));
    const store = new Palistor({
      config: {
        name: { value: "" },
        resolve: { resolver, onError: vi.fn(), contextDeps: ["vehicleSlug", "accountId"], options: { lazy: true } },
      } as any,
    });
    void (store.proxy as any).name.value;
    await flush();
    store.setContext({ vehicleSlug: "car-1" });
    await flush();
    expect(resolver).not.toHaveBeenCalled();
    store.setContext({ accountId: "acc" });
    await flush();
    expect(resolver).toHaveBeenCalledTimes(1);
    expect((store.proxy as any).name.value).toBe("N");
  });

  it("a lazy resolve nobody has read stays put when the keys arrive", async () => {
    const { store, car, resolver } = groupStore({ contextDeps: ["accountId"] });
    store.setContext({ accountId: "acc" });
    await flush();
    expect(resolver).not.toHaveBeenCalled();
    void car.brand.value;
    await flush();
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("an eager resolve (lazy: false) waits too, and starts on setContext", async () => {
    const { store, car, resolver } = groupStore({ contextDeps: ["accountId"], lazy: false });
    await flush();
    expect(resolver).not.toHaveBeenCalled();
    store.setContext({ accountId: "acc" });
    await flush();
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(car.brand.value).toBe("brand-acc");
  });

  it("the constructor's `context` satisfies it from the start", async () => {
    const { car, resolver } = groupStore({ contextDeps: ["accountId"], lazy: false, context: { accountId: "init" } });
    await flush();
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(car.brand.value).toBe("brand-init");
  });

  it("a waiting resolve with suspense does not suspend (nothing is in flight)", async () => {
    const { car } = groupStore({ contextDeps: ["accountId"], suspense: true });
    void car.brand.value;
    await flush();
    expect(() => car.brand.value).not.toThrow();
  });

  it("the key going away: the resolve waits with its last result; dep changes meanwhile wait; the key back runs once with current values", async () => {
    const resolver = vi.fn(async (values: any, store: any) => ({ brand: `${values.userId}-${store.context.acc}` }));
    const store = new Palistor({
      config: {
        userId: { value: "u1" },
        car: { resolve: { resolver, onError: vi.fn(), contextDeps: ["acc"] }, brand: { value: "" } },
      } as any,
      context: { acc: "A" },
    });
    const proxy = store.proxy as any;
    void proxy.car.brand.value;
    await flush();
    expect(proxy.car.brand.value).toBe("u1-A");

    store.setContext({ acc: undefined });
    await flush();
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(proxy.car.brand.value).toBe("u1-A");
    expect(proxy.car.loading).toBe(false);

    proxy.userId.value = "u2";
    await flush();
    expect(resolver).toHaveBeenCalledTimes(1);

    store.setContext({ acc: "B" });
    await flush();
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(proxy.car.brand.value).toBe("u2-B");
  });
});
