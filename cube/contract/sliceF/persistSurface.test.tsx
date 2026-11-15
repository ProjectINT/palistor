/**
 * Persist surface beyond store's persist tests. New in the contract (Phase
 * 2.4); every case is what store's PersistManager and usePersist do by design
 * and is green on store:
 *
 *  - usePersist: mount hydrates and autosaves, unmount flushes the pending
 *    change and disables, a key change moves to the new key, StrictMode with a
 *    slow driver loses nothing;
 *  - the built-in localStorage / sessionStorage drivers round-trip;
 *  - hydration is raw state: one notification, no formatter / setter /
 *    onChange; root fields are dirty against their config defaults, restored
 *    list membership and newly restored rows are not, a merged existing row
 *    keeps its baseline;
 *  - list filters are view state: never saved, never hydrated;
 *  - a leaf submit keeps the snapshot, a group submit clears it;
 *  - onError gets hydrate and save failures, a throwing onError is swallowed;
 *  - hydrate() re-reads; a non-object snapshot and unknown keys are ignored;
 *    a restored root list replaces its membership, dropped rows stay in the
 *    registry; enable() resolves after hydration.
 */
import { describe, it, expect, vi } from "vitest";
import { StrictMode } from "react";
import { act, render, renderHook, screen } from "@testing-library/react";
import { Palistor, defineList, localStorageDriver, sessionStorageDriver, useForm, usePersist } from "@impl";

const flushPromises = () => new Promise<void>((r) => setTimeout(r, 0));
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function memoryDriver(getDelay = 0) {
  const storage = new Map<string, string>();
  return {
    storage,
    getItem: (k: string) =>
      getDelay > 0 ? delay(getDelay).then(() => storage.get(k) ?? null) : storage.get(k) ?? null,
    setItem: vi.fn((k: string, v: string) => void storage.set(k, v)),
    removeItem: (k: string) => void storage.delete(k),
  };
}

const saved = (d: { storage: Map<string, string> }, key: string) => {
  const raw = d.storage.get(key);
  return raw === undefined ? undefined : JSON.parse(raw);
};

const formConfig = () => ({
  email: { value: "" },
  name: { value: "" },
});

// ─── usePersist ──────────────────────────────────────────────────────────────

describe("usePersist", () => {
  it("mount hydrates and autosaves; a component reading the field shows the stored value", async () => {
    const driver = memoryDriver();
    driver.storage.set("form", JSON.stringify({ email: "stored@x" }));
    const store = new Palistor({ config: formConfig() });

    function Page() {
      usePersist(store as any, { key: "form", driver, debounce: 0 });
      const form = useForm(store);
      return <span data-testid="email">{form.email.value}</span>;
    }
    render(<Page />);
    await act(async () => { await flushPromises(); });
    expect(screen.getByTestId("email").textContent).toBe("stored@x");

    await act(async () => {
      store.proxy.name.value = "Ann";
      await flushPromises();
    });
    expect(saved(driver, "form")).toMatchObject({ email: "stored@x", name: "Ann" });
  });

  it("unmount flushes the pending change and disables persistence", async () => {
    const driver = memoryDriver();
    const store = new Palistor({ config: formConfig() });
    const { unmount } = renderHook(() => usePersist(store as any, { key: "form", driver, debounce: 10_000 }));
    await act(async () => { await flushPromises(); });

    store.proxy.email.value = "typed@x";
    expect(driver.storage.has("form")).toBe(false); // still inside the debounce
    unmount();
    expect(saved(driver, "form")).toMatchObject({ email: "typed@x" });
    expect(store.persist.isEnabled()).toBe(false);

    store.proxy.email.value = "after@x";
    await delay(20);
    expect(saved(driver, "form")).toMatchObject({ email: "typed@x" });
  });

  it("a key change saves under the old key and hydrates from the new one", async () => {
    const driver = memoryDriver();
    driver.storage.set("order-2", JSON.stringify({ email: "two@x" }));
    const store = new Palistor({ config: formConfig() });
    const { rerender } = renderHook(
      ({ id }) => usePersist(store as any, { key: `order-${id}`, driver, debounce: 10_000 }),
      { initialProps: { id: 1 } },
    );
    await act(async () => { await flushPromises(); });
    store.proxy.email.value = "one@x";

    rerender({ id: 2 });
    await act(async () => { await flushPromises(); });
    expect(saved(driver, "order-1")).toMatchObject({ email: "one@x" });
    expect(store.proxy.email.value).toBe("two@x");
    expect(saved(driver, "order-2")).toEqual({ email: "two@x" });
  });

  it("StrictMode with a slow driver: the stored snapshot survives the double effect and lands", async () => {
    const driver = memoryDriver(20);
    driver.storage.set("form", JSON.stringify({ email: "stored@x", name: "Stored" }));
    const store = new Palistor({ config: formConfig() });

    function Page() {
      usePersist(store as any, { key: "form", driver, debounce: 0 });
      return <span data-testid="email">{useForm(store).email.value}</span>;
    }
    render(<StrictMode><Page /></StrictMode>);
    await act(async () => { await delay(60); });

    expect(screen.getByTestId("email").textContent).toBe("stored@x");
    expect(saved(driver, "form")).toEqual({ email: "stored@x", name: "Stored" });
  });
});

// ─── built-in drivers ────────────────────────────────────────────────────────

describe("built-in drivers", () => {
  it.each([
    ["localStorageDriver", localStorageDriver, () => localStorage],
    ["sessionStorageDriver", sessionStorageDriver, () => sessionStorage],
  ] as const)("%s round-trips through the browser storage", async (_name, driver, storage) => {
    storage().clear();
    const store1 = new Palistor({ config: formConfig() });
    await store1.persist.enable({ key: "web", driver, debounce: 0 });
    store1.proxy.email.value = "web@x";
    await store1.persist.flush();
    expect(JSON.parse(storage().getItem("web")!)).toMatchObject({ email: "web@x" });

    const store2 = new Palistor({ config: formConfig() });
    await store2.persist.enable({ key: "web", driver });
    expect(store2.proxy.email.value).toBe("web@x");

    await store2.persist.clear();
    expect(storage().getItem("web")).toBeNull();
  });
});

// ─── hydration is raw state ──────────────────────────────────────────────────

describe("hydration", () => {
  it("is one notification and runs no formatter, setter or onChange", async () => {
    const onChange = vi.fn();
    const setter = vi.fn(() => ({}));
    const driver = memoryDriver();
    driver.storage.set("k", JSON.stringify({ email: "Mixed@Case", name: "n", group: { inner: "i" } }));
    const store = new Palistor({
      config: {
        email: { value: "", formatter: (v: string) => String(v).toLowerCase(), setter, onChange },
        name: { value: "" },
        group: { inner: { value: "" }, onChange },
        onChange,
      } as any,
    });
    const listener = vi.fn();
    store.subscribeGlobal(listener);

    await store.persist.enable({ key: "k", driver });
    await flushPromises();

    expect(listener).toHaveBeenCalledTimes(1);
    expect((store.proxy as any).email.value).toBe("Mixed@Case");
    expect((store.proxy as any).group.inner.value).toBe("i");
    expect(setter).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("root fields are dirty against their defaults; restored membership and new rows are not", async () => {
    const driver = memoryDriver();
    driver.storage.set("k", JSON.stringify({ title: "Draft", users: [{ id: "u1", name: "Ann" }] }));
    const store = new Palistor({
      config: {
        title: { value: "" },
        users: defineList({ template: { id: { value: "" }, name: { value: "" } } }),
      } as any,
    });
    await store.persist.enable({ key: "k", driver });

    const proxy = store.proxy as any;
    expect(proxy.title.dirty).toBe(true);
    expect(proxy.users.dirty).toBe(false);
    expect(proxy.users.items[0].name.value).toBe("Ann");
    expect(proxy.users.items[0].name.dirty).toBe(false);
    expect(proxy.users.items[0].dirty).toBe(false);
  });

  it("an existing row is merged: absent keys survive, a changed key is dirty against its old baseline", async () => {
    const driver = memoryDriver();
    driver.storage.set("k", JSON.stringify({ users: [{ id: "u1", name: "Saved" }] }));
    const store = new Palistor({
      config: {
        users: defineList({ template: { id: { value: "" }, name: { value: "" }, age: { value: 0 } } }),
      } as any,
    });
    store.set({ id: "u1", name: "Orig", age: 5 });
    (store.proxy as any).users.add("u1");

    await store.persist.enable({ key: "k", driver });

    const item = (store.proxy as any).users.items[0];
    expect(item.name.value).toBe("Saved");
    expect(item.age.value).toBe(5);
    expect(item.name.dirty).toBe(true);
  });

  it("a restored root list replaces its membership; dropped rows stay in the registry", async () => {
    const driver = memoryDriver();
    driver.storage.set("k", JSON.stringify({ users: [{ id: "u9", name: "Restored" }] }));
    const store = new Palistor({
      config: { users: defineList({ template: { id: { value: "" }, name: { value: "" } } }) } as any,
    });
    store.set({ id: "u1", name: "Local" });
    (store.proxy as any).users.add("u1");

    await store.persist.enable({ key: "k", driver });

    expect((store.proxy as any).users.items.map((i: any) => i.id)).toEqual(["u9"]);
    expect(store.entityRegistry.has("u1")).toBe(true);
    expect((store.proxy as any).users.dirty).toBe(false);
  });

  it("hydrate() re-reads the storage; a non-object snapshot and unknown keys are ignored", async () => {
    const driver = memoryDriver();
    const store = new Palistor({ config: { a: { value: "" }, b: { value: 0 } } as any });
    await store.persist.enable({ key: "h", driver, debounce: 10_000 });

    driver.storage.set("h", JSON.stringify({ a: "fresh", unknown: 1 }));
    await store.persist.hydrate();
    expect(store.getValues()).toEqual({ a: "fresh", b: 0 });

    for (const junk of [[1, 2], "text", 42, null]) {
      driver.storage.set("h", JSON.stringify(junk));
      await store.persist.hydrate();
      expect(store.getValues()).toEqual({ a: "fresh", b: 0 });
    }
  });

  it("enable() resolves after hydration; persistence counts as enabled while it is in flight", async () => {
    const driver = memoryDriver(20);
    driver.storage.set("w", JSON.stringify({ email: "late@x" }));
    const store = new Palistor({ config: formConfig() });

    const p = store.persist.enable({ key: "w", driver });
    expect(store.persist.isEnabled()).toBe(true);
    expect(store.proxy.email.value).toBe("");
    await expect(p).resolves.toBeUndefined();
    expect(store.proxy.email.value).toBe("late@x");
  });
});

// ─── list filters are view state ─────────────────────────────────────────────

describe("list filters", () => {
  it("are never saved and never hydrated", async () => {
    const driver = memoryDriver();
    const config = () => ({
      title: { value: "" },
      users: defineList({
        template: { id: { value: "" }, name: { value: "" } },
        filter: { q: { value: "", where: (row: any, q: string) => row.name.includes(q) } },
      } as any),
    });
    const store = new Palistor({ config: config() as any });
    await store.persist.enable({ key: "f", driver, debounce: 0 });
    (store.proxy as any).users.filter.q.value = "zz";
    (store.proxy as any).title.value = "t";
    await store.persist.flush();
    expect(saved(driver, "f")).toEqual({ title: "t", users: [] });

    driver.storage.set("f", JSON.stringify({ title: "t2", $filters: { users: { q: "evil" } }, users: [] }));
    const store2 = new Palistor({ config: config() as any });
    await store2.persist.enable({ key: "f", driver });
    expect((store2.proxy as any).title.value).toBe("t2");
    expect((store2.proxy as any).users.filter.q.value).toBe("");
  });
});

// ─── submit ──────────────────────────────────────────────────────────────────

describe("submit", () => {
  it("a leaf submit keeps the snapshot, a nested group submit clears it", async () => {
    const driver = memoryDriver();
    const store = new Palistor({
      config: {
        a: { value: "", onSubmit: async () => 1 },
        g: { b: { value: "" }, onSubmit: async () => 2 },
      } as any,
    });
    await store.persist.enable({ key: "s", driver, debounce: 10_000 });
    (store.proxy as any).a.value = "x";
    await store.persist.flush();

    await (store.proxy as any).a.submit();
    expect(driver.storage.has("s")).toBe(true);

    await (store.proxy as any).g.submit();
    expect(driver.storage.has("s")).toBe(false);
  });
});

// ─── onError ─────────────────────────────────────────────────────────────────

describe("onError", () => {
  it("gets hydrate failures: a corrupt snapshot and a throwing getItem", async () => {
    const onError = vi.fn();
    const driver = memoryDriver();
    driver.storage.set("bad", "{{not json");
    const store = new Palistor({ config: formConfig() });
    await store.persist.enable({ key: "bad", driver, onError });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][1]).toBe("hydrate");

    const failing = { getItem: () => { throw new Error("read"); }, setItem: () => {}, removeItem: () => {} };
    await store.persist.enable({ key: "other", driver: failing, onError });
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError.mock.calls[1]).toEqual([expect.objectContaining({ message: "read" }), "hydrate"]);
  });

  it("gets save failures; a throwing onError never breaks the store", async () => {
    const error = new Error("write");
    const failing = { getItem: () => null, setItem: () => { throw error; }, removeItem: () => {} };
    const onError = vi.fn();
    const store = new Palistor({ config: formConfig() });
    await store.persist.enable({ key: "k", driver: failing, debounce: 10_000, onError });
    store.proxy.email.value = "x";
    await store.persist.flush();
    expect(onError).toHaveBeenCalledWith(error, "save");

    const store2 = new Palistor({ config: formConfig() });
    await store2.persist.enable({ key: "k", driver: failing, debounce: 0, onError: () => { throw new Error("cb"); } });
    store2.proxy.email.value = "y";
    await expect(store2.persist.flush()).resolves.toBeUndefined();
    expect(store2.proxy.email.value).toBe("y");
  });
});
