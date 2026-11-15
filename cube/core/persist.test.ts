/**
 * Persist behavior that differs from store on purpose (cube project only).
 * Shared behavior is in cube/contract/sliceF.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { Palistor } from "../palistor";
import { defineList } from "../defineList";
import { localStorageDriver } from "./persist";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function memoryDriver() {
  const storage = new Map<string, string>();
  return {
    storage,
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: vi.fn((k: string, v: string) => void storage.set(k, v)),
    removeItem: (k: string) => void storage.delete(k),
  };
}

describe("clear on a successful submit", () => {
  // store: persist.clear() runs before the `submitting: false` notification,
  // which schedules a save; after the debounce the submitted values are back
  // in storage (with debounce 0 the storage is never empty at all), and
  // usePersist's unmount flush writes them back too. The draft resurrects.
  it.each([0, 30])("sticks past the debounce and the unmount flush (debounce %i)", async (debounce) => {
    const driver = memoryDriver();
    const store = new Palistor({
      config: { email: { value: "" }, onSubmit: async () => ({ ok: true }) },
    });
    await store.persist.enable({ key: "s", driver, debounce });
    store.proxy.email.value = "x@y";
    await store.persist.flush();
    expect(driver.storage.has("s")).toBe(true);

    expect((await store.submit()).success).toBe(true);
    await delay(debounce + 20);
    expect(driver.storage.has("s")).toBe(false);
    await store.persist.flush();
    expect(driver.storage.has("s")).toBe(false);

    // The next real change is a new draft.
    store.proxy.email.value = "next@y";
    await store.persist.flush();
    expect(JSON.parse(driver.storage.get("s")!)).toEqual({ email: "next@y" });
  });

  it("an afterSubmit reset leaves the storage empty, not holding the defaults", async () => {
    const driver = memoryDriver();
    const store = new Palistor({
      config: {
        email: { value: "" },
        onSubmit: async () => 1,
        afterSubmit: (_r: unknown, { reset }: { reset(): void }) => reset(),
      },
    });
    await store.persist.enable({ key: "s", driver, debounce: 30 });
    store.proxy.email.value = "x@y";
    await store.persist.flush();

    await store.submit();
    await delay(60);
    expect(store.proxy.email.value).toBe("");
    expect(driver.storage.has("s")).toBe(false);
  });
});

describe("writes", () => {
  // store writes on every notification cycle, values changed or not.
  it("a cycle that leaves the values as they were writes nothing", async () => {
    const driver = memoryDriver();
    const store = new Palistor({
      config: { email: { value: "", validate: (v: string) => (v ? undefined : "required") } },
    });
    await store.persist.enable({ key: "w", driver, debounce: 0 });
    store.proxy.email.value = "a";
    await delay(0);
    expect(driver.setItem).toHaveBeenCalledTimes(1);

    store.proxy.email.value = "";
    await delay(0);
    expect(driver.setItem).toHaveBeenCalledTimes(2);

    expect((await store.submit()).success).toBe(false); // submitting / revalidate cycles
    await delay(0);
    expect(driver.setItem).toHaveBeenCalledTimes(2);
  });

  it("a resolve's status cycles write nothing when its result changes no value", async () => {
    const driver = memoryDriver();
    let release!: () => void;
    const store = new Palistor({
      config: {
        email: { value: "" },
        city: { value: "", resolve: { resolver: () => new Promise<string>((r) => { release = () => r(""); }) } },
      },
    });
    await store.persist.enable({ key: "w", driver, debounce: 0 });
    store.proxy.email.value = "a";
    await delay(0);
    expect(driver.setItem).toHaveBeenCalledTimes(1);

    void store.proxy.city.loading; // a lazy resolve: pending, then resolved with the same value
    await delay(0);
    expect(store.proxy.city.loading).toBe(true);
    release();
    await delay(0);
    expect(store.proxy.city.loading).toBe(false);
    expect(driver.setItem).toHaveBeenCalledTimes(1);
  });

  it("restoring a list with a repeated id keeps one item", async () => {
    const driver = memoryDriver();
    driver.storage.set("d", JSON.stringify({ users: [{ id: "u1", name: "A" }, { id: "u1", name: "B" }] }));
    const store = new Palistor({
      config: { users: defineList({ template: { id: { value: "" }, name: { value: "" } } }) },
    });
    await store.persist.enable({ key: "d", driver });
    expect(store.proxy.users.items.map((i: { id: string }) => i.id)).toEqual(["u1"]);
    expect(store.proxy.users.items[0].name.value).toBe("B");
  });
});

describe("built-in drivers", () => {
  afterEach(() => vi.restoreAllMocks());

  // store's drivers caught setItem errors, so a QuotaExceededError never
  // reached onError — the very failure its docs single out.
  it("a quota error from localStorage reaches onError", async () => {
    const quota = Object.assign(new Error("quota"), { name: "QuotaExceededError" });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw quota; });
    const onError = vi.fn();
    const store = new Palistor({ config: { email: { value: "" } } });
    await store.persist.enable({ key: "q", driver: localStorageDriver, debounce: 10_000, onError });
    store.proxy.email.value = "x";
    await store.persist.flush();
    expect(onError).toHaveBeenCalledWith(quota, "save");
  });
});
