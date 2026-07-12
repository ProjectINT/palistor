/**
 * Regression: unguarded async hydration caused two data-loss races.
 *
 * 1. Superseded enable(): enable(k2) disables the k1 instance, but k1's
 *    already-running hydration promise kept going and applied its patch when
 *    it resolved — if k1's driver was slower, the store ended up with k1's
 *    data while the active persist key was k2, and the next autosave wrote
 *    k1's data into k2 (cross-key corruption). Real-world trigger: account
 *    switch, or React StrictMode double-effect with usePersist (which doesn't
 *    await enable()).
 *
 * 2. flush() mid-hydration: flush → saveToStorage read the current
 *    (not-yet-hydrated, empty) values and overwrote the stored snapshot —
 *    the isHydrating flag guarded only the debounced scheduleSave. Real-world
 *    trigger: usePersist's cleanup calls flush() on unmount; unmount during
 *    load destroyed the saved data.
 *
 * Fix: a hydration generation token (bumped by enable/disable) — a hydration
 * run applies its result only if the generation is still current; flush() is
 * a no-op while hydration is in flight.
 */
import { describe, it, expect } from "vitest";
import { Palistor } from "../store";

function mkDriver(delay: number, backing: Map<string, string>) {
  return {
    getItem: async (k: string) => {
      await new Promise((r) => setTimeout(r, delay));
      return backing.get(k) ?? null;
    },
    setItem: async (k: string, v: string) => {
      backing.set(k, v);
    },
    removeItem: async (k: string) => {
      backing.delete(k);
    },
  };
}

describe("persist hydration races", () => {
  it("a superseded enable()'s slow hydration must not land over the newer one", async () => {
    const backing = new Map<string, string>();
    backing.set("k1", JSON.stringify({ email: "one@x" }));
    backing.set("k2", JSON.stringify({ email: "two@x" }));
    const store = new Palistor({ config: { email: { value: "" } } as any });

    void (store as any).persist.enable({ key: "k1", driver: mkDriver(50, backing), debounce: 10000 });
    void (store as any).persist.enable({ key: "k2", driver: mkDriver(10, backing), debounce: 10000 });

    await new Promise((r) => setTimeout(r, 120));
    expect((store.proxy as any).email.value).toBe("two@x");
  });

  it("disable() during hydration aborts applying it", async () => {
    const backing = new Map<string, string>();
    backing.set("k", JSON.stringify({ email: "stored@x" }));
    const store = new Palistor({ config: { email: { value: "" } } as any });

    void (store as any).persist.enable({ key: "k", driver: mkDriver(40, backing), debounce: 10000 });
    await new Promise((r) => setTimeout(r, 10));
    (store as any).persist.disable();

    await new Promise((r) => setTimeout(r, 80));
    expect((store.proxy as any).email.value).toBe(""); // hydration was aborted
  });

  it("flush() mid-hydration must not overwrite the stored payload", async () => {
    const backing = new Map<string, string>();
    backing.set("k", JSON.stringify({ email: "stored@x", name: "Stored" }));
    const store = new Palistor({
      config: { email: { value: "" }, name: { value: "" } } as any,
    });

    const p = (store as any).persist.enable({ key: "k", driver: mkDriver(80, backing), debounce: 10000 });
    await new Promise((r) => setTimeout(r, 20));
    await (store as any).persist.flush(); // mid-hydration
    await p;

    expect(JSON.parse(backing.get("k")!)).toMatchObject({ email: "stored@x", name: "Stored" });
    // and the hydration itself landed
    expect((store.proxy as any).email.value).toBe("stored@x");
  });

  it("control: sequential enable() → hydrate → flush works", async () => {
    const backing = new Map<string, string>();
    backing.set("k", JSON.stringify({ email: "stored@x" }));
    const store = new Palistor({ config: { email: { value: "" } } as any });

    await (store as any).persist.enable({ key: "k", driver: mkDriver(5, backing), debounce: 10000 });
    expect((store.proxy as any).email.value).toBe("stored@x");

    (store.proxy as any).email.value = "edited@x";
    await (store as any).persist.flush();
    expect(JSON.parse(backing.get("k")!)).toMatchObject({ email: "edited@x" });
  });
});
