/**
 * Persist round-trip tests for per-entity nested lists.
 *
 * Verifies:
 *   - getValues includes nested lists → they serialize into the snapshot;
 *   - hydrate restores the root list + per-entity lists with owners;
 *   - a save → reload → restore round-trip is equivalent to the original state;
 *   - an old snapshot without nested lists loads without errors (graceful);
 *   - 3-level nesting survives the round-trip.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Palistor } from "./store";
import { defineList } from "./defineList";
import type { PersistDriver } from "./persist/types";

function createMemoryDriver(): PersistDriver & { storage: Map<string, string> } {
  const storage = new Map<string, string>();
  return {
    storage,
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
  };
}

function makeStore() {
  return new Palistor({
    config: {
      title: { value: "" },
      users: defineList({
        template: {
          id: { value: "" },
          name: { value: "" },
          contacts: defineList({
            template: {
              id: { value: "" },
              phone: { value: "" },
            },
          }),
        },
      }),
    } as any,
  });
}

describe("per-entity list persist round-trip (C3)", () => {
  let driver: ReturnType<typeof createMemoryDriver>;

  beforeEach(() => {
    driver = createMemoryDriver();
  });

  it("save serializes the nested contacts into the snapshot", async () => {
    const store = makeStore();
    store.proxy.title.value = "Team";
    store.set([{ id: "u1", name: "Alice" }, { id: "u2", name: "Bob" }]);
    (store.proxy as any).users.add("u1");
    (store.proxy as any).users.add("u2");
    (store.proxy as any).users.items[0].contacts.add({ id: "c1", phone: "+1" });
    (store.proxy as any).users.items[1].contacts.add({ id: "c2", phone: "+2" });

    await store.persist.enable({ key: "k", driver, debounce: 0 });
    await store.persist.flush();

    const saved = JSON.parse(driver.storage.get("k")!);
    expect(saved.title).toBe("Team");
    expect(saved.users[0].contacts).toEqual([{ id: "c1", phone: "+1" }]);
    expect(saved.users[1].contacts).toEqual([{ id: "c2", phone: "+2" }]);
  });

  it("round-trip: a reload restores the root and per-entity lists", async () => {
    const store1 = makeStore();
    store1.set([{ id: "u1", name: "Alice" }, { id: "u2", name: "Bob" }]);
    (store1.proxy as any).users.add("u1");
    (store1.proxy as any).users.add("u2");
    (store1.proxy as any).users.items[0].contacts.add({ id: "c1", phone: "+1" });
    (store1.proxy as any).users.items[0].contacts.add({ id: "c2", phone: "+2" });
    (store1.proxy as any).users.items[1].contacts.add({ id: "c3", phone: "+3" });

    await store1.persist.enable({ key: "k", driver, debounce: 0 });
    await store1.persist.flush();

    // A new store with the same config — hydrated from storage.
    const store2 = makeStore();
    await store2.persist.enable({ key: "k", driver });

    expect(store2.getValues()).toEqual(store1.getValues());

    // The root list is restored.
    expect((store2.proxy as any).users.length).toBe(2);
    // The per-entity lists are restored with the right membership.
    expect((store2.proxy as any).users.items[0].contacts.getValues()).toEqual([
      { id: "c1", phone: "+1" },
      { id: "c2", phone: "+2" },
    ]);
    expect((store2.proxy as any).users.items[1].contacts.getValues()).toEqual([
      { id: "c3", phone: "+3" },
    ]);

    // Owner references are restored → cascade deletion works.
    expect(store2.entityRegistry.get("c1")!.owner!.ownerId).toBe("u1");
    store2.delete("u1");
    expect(store2.entityRegistry.has("c1")).toBe(false);
    expect(store2.entityRegistry.has("c2")).toBe(false);
    expect(store2.entityRegistry.has("c3")).toBe(true);
  });

  it("an old snapshot without nested lists loads without errors (graceful)", async () => {
    driver.storage.set(
      "legacy",
      JSON.stringify({ title: "Legacy", users: [{ id: "u1", name: "Old" }] }),
    );

    const store = makeStore();
    await expect(store.persist.enable({ key: "legacy", driver })).resolves.toBeUndefined();

    expect(store.proxy.title.value).toBe("Legacy");
    expect((store.proxy as any).users.length).toBe(1);
    // contacts are absent from the snapshot → the list is empty, no crash.
    expect((store.proxy as any).users.items[0].contacts.getValues()).toEqual([]);
  });

  it("the round-trip survives 3-level nesting", async () => {
    const make3 = () =>
      new Palistor({
        config: {
          users: defineList({
            template: {
              id: { value: "" },
              name: { value: "" },
              contacts: defineList({
                template: {
                  id: { value: "" },
                  phone: { value: "" },
                  emails: defineList({
                    template: { id: { value: "" }, addr: { value: "" } },
                  }),
                },
              }),
            },
          }),
        } as any,
      });

    const store1 = make3();
    store1.set({ id: "u1", name: "Alice" });
    (store1.proxy as any).users.add("u1");
    const c = (store1.proxy as any).users.items[0].contacts;
    c.add({ id: "c1", phone: "+1" });
    c.items[0].emails.add({ id: "e1", addr: "a@x.io" });

    await store1.persist.enable({ key: "deep", driver, debounce: 0 });
    await store1.persist.flush();

    const store2 = make3();
    await store2.persist.enable({ key: "deep", driver });

    expect(store2.getValues()).toEqual(store1.getValues());
    expect(
      (store2.proxy as any).users.items[0].contacts.items[0].emails.getValues(),
    ).toEqual([{ id: "e1", addr: "a@x.io" }]);
  });
});
