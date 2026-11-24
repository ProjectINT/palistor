/**
 * Resolve behavior that differs from store on purpose (cube project only).
 * Shared behavior is in cube/contract/sliceB and sliceJ.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { Palistor } from "../palistor";
import { defineList } from "../defineList";
import { useForm } from "../react/useForm";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("restart cap", () => {
  // store: every dependency restart counts against MAX_AUTO_RETRIGGERS (10) and
  // only a manual trigger or setContext resets it, so a resolver reading a form
  // field stops following it after 10 edits (26 edits → 11 calls).
  it("edits from outside a resolve are never counted: 26 edits, 27 runs", async () => {
    const resolver = vi.fn(async (values: any) => ({ brand: String(values.userId) }));
    const store = new Palistor({
      config: { userId: { value: "0" }, car: { resolve: { resolver }, brand: { value: "" } } },
    });
    const proxy = store.proxy as any;
    void proxy.car.brand.value;
    await flush();
    for (let i = 1; i <= 26; i++) {
      proxy.userId.value = String(i);
      await flush();
    }
    expect(resolver).toHaveBeenCalledTimes(27);
    expect(proxy.car.brand.value).toBe("26");
  });

  it("a cycle stops at the cap and stays stopped; an outside change re-arms it for another bounded round", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const ra = vi.fn(async (values: any) => ({ x: values.b.y + 1 }));
      const rb = vi.fn(async (values: any) => ({ y: values.a.x + 1 }));
      const store = new Palistor({
        config: {
          a: { resolve: { resolver: ra, options: { lazy: false } }, x: { value: 0 } },
          b: { resolve: { resolver: rb, options: { lazy: false } }, y: { value: 0 } },
        },
      });
      for (let i = 0; i < 150; i++) await flush();
      const first = ra.mock.calls.length + rb.mock.calls.length;
      expect(first).toBeLessThanOrEqual(2 * 21 + 2);
      const warned = warn.mock.calls.length; // at most once per resolve and streak
      expect(warned).toBeGreaterThanOrEqual(1);
      expect(warned).toBeLessThanOrEqual(2);
      for (let i = 0; i < 50; i++) await flush();
      expect(ra.mock.calls.length + rb.mock.calls.length).toBe(first);

      (store.proxy as any).a.x.value = 100; // b reads it
      for (let i = 0; i < 150; i++) await flush();
      const second = ra.mock.calls.length + rb.mock.calls.length - first;
      expect(second).toBeGreaterThan(10);
      expect(second).toBeLessThanOrEqual(2 * 21 + 2);
      expect(warn.mock.calls.length).toBeGreaterThan(warned);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("group loading", () => {
  // store: recomputeLeaves carries submitting / dirty / revalidate into the
  // recomputed node state but not loading, so a group with any computed key
  // (label, isVisible, …) shows loading: false while its resolve runs.
  it("stays true while the run is pending on a group with a label", async () => {
    let release!: (v: unknown) => void;
    const store = new Palistor({
      config: {
        car: {
          label: "Car",
          isVisible: () => true,
          resolve: { resolver: () => new Promise((r) => { release = r; }) },
          brand: { value: "" },
        },
      },
    });
    const car = (store.proxy as any).car;
    void car.brand.value;
    await flush();
    expect(car.loading).toBe(true);
    release({ brand: "T" });
    await flush();
    expect(car.loading).toBe(false);
  });
});

describe("onError gets the store's translator", () => {
  // store: the context is { notify } only, so an error toast could not be translated by the config.
  type Ctx = { notify: (...args: any[]) => void; t: (key: string, ...args: any[]) => string };
  const en = (key: string) => `en:${key}`;
  const de = (key: string) => `de:${key}`;
  const boom = async (): Promise<never> => { throw new Error("boom"); };
  /** onError the way a config writes it: the message goes through `t`. */
  const report = (key: string) => (_error: unknown, { notify, t }: Ctx) => notify(t(key));

  it("a group, a list, a paginated list and a row field: every onError can translate its message", async () => {
    const notifier = vi.fn();
    const store = new Palistor({
      translator: en,
      notifier,
      config: {
        profile: { resolve: { resolver: boom, onError: report("profile") }, name: { value: "" } },
        users: defineList({
          template: { id: { value: "" }, score: { value: 0, resolve: { resolver: boom, onError: report("score") } } },
          resolve: { resolver: boom, onError: report("users") },
        }) as any,
        orders: defineList({
          template: { id: { value: "" } },
          resolve: { resolver: boom, onError: report("orders"), pagination: { pageSize: 10 } },
        }) as any,
      },
    });
    const p = store.proxy as any;
    void p.profile.name.value;
    void p.users.items;
    void p.orders.items;
    await flush();
    store.set({ id: "u1", score: 0 });
    p.users.add("u1");
    void p.users.items[0].score.value;
    await flush();

    expect(notifier.mock.calls.map((c) => c[0]).sort()).toEqual(["en:orders", "en:profile", "en:score", "en:users"]);
  });

  it("the template resolve of useForm(entity, template) gets it too", async () => {
    const notifier = vi.fn();
    const store = new Palistor({
      translator: en,
      notifier,
      config: {
        users: [{ id: { value: "" }, name: { value: "" } }],
        editUser: { name: { value: "" }, resolve: { resolver: boom, onError: report("editUser") } },
      } as any,
    });
    store.set({ id: "u1", name: "Ann" });
    (store.proxy as any).users.add("u1");
    renderHook(() => useForm((store.proxy as any).users.items[0], (proxy: any) => proxy.editUser));
    await act(flush);

    expect(notifier.mock.calls).toEqual([["en:editUser"]]);
  });

  it("`t` is the current translator: one reference that follows setTranslator, and the key without a translator", async () => {
    const seen: Ctx[] = [];
    const store = new Palistor({
      config: {
        filter: { value: "" },
        profile: {
          resolve: { resolver: boom, deps: ["filter"], onError: (_error: unknown, ctx: Ctx) => { seen.push(ctx); } },
          name: { value: "" },
        },
      },
    });
    const p = store.proxy as any;
    void p.profile.name.value;
    await flush();
    expect(seen[0].t("load")).toBe("load"); // no translator: the identity

    store.setTranslator(de);
    expect(seen[0].t("load")).toBe("de:load"); // a `t` kept from the first error follows the switch
    p.filter.value = "x";
    await flush();
    expect(seen).toHaveLength(2);
    expect(seen[1].t).toBe(seen[0].t);
    expect(seen[1].notify).toBe(seen[0].notify);
    expect(seen[1]).not.toBe(seen[0]); // a context object of its own per call
  });
});
