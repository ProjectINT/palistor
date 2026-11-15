/**
 * Resolve behavior that differs from store on purpose (cube project only).
 * Shared behavior is in cube/contract/sliceB and sliceJ.
 */
import { describe, it, expect, vi } from "vitest";
import { Palistor } from "../palistor";

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
