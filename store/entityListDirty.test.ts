/**
 * Dirty tests for per-entity nested lists.
 *
 * Verifies:
 *   - list.dirty by membership (itemIds vs initialItemIds);
 *   - the owner's dirty (entityProxy.dirty) aggregates list composition;
 *   - add/remove affect dirty; going back to initial → dirty=false;
 *   - reset() restores the initial membership and clears dirty.
 */

import { describe, it, expect, vi } from "vitest";
import { Palistor } from "./store";
import { defineList } from "./defineList";

function flush() {
  return new Promise<void>((r) => setTimeout(r, 0));
}

function makeStore(resolver?: (...a: any[]) => any) {
  const store = new Palistor({
    config: {
      users: defineList({
        template: {
          id: { value: "" },
          name: { value: "" },
          contacts: defineList({
            template: {
              id: { value: "" },
              phone: { value: "" },
            },
            ...(resolver ? { resolve: { resolver, onError: vi.fn() } } : {}),
          }),
        },
      }),
    } as any,
  });
  store.set({ id: "u1", name: "Alice" });
  (store.proxy as any).users.add("u1");
  return store;
}

describe("per-entity list dirty (C3)", () => {
  it("an empty untouched list is not dirty", () => {
    const store = makeStore();
    const list = (store.proxy as any).users.items[0].contacts;
    expect(list.dirty).toBe(false);
  });

  it("add makes the list dirty, and the owner too", () => {
    const store = makeStore();
    const u1 = (store.proxy as any).users.items[0];
    const list = u1.contacts;

    expect(u1.dirty).toBe(false);
    list.add({ id: "c1", phone: "+1" });

    expect(list.dirty).toBe(true);
    expect(u1.dirty).toBe(true);
  });

  it("restoring the membership to initial clears dirty", () => {
    const store = makeStore();
    const list = (store.proxy as any).users.items[0].contacts;

    list.add({ id: "c1", phone: "+1" });
    expect(list.dirty).toBe(true);

    list.remove("c1");
    // itemIds is empty again == initial → not dirty.
    expect(list.dirty).toBe(false);
    expect((store.proxy as any).users.items[0].dirty).toBe(false);
  });

  it("after the resolve the list is not dirty (initialItemIds is synced)", async () => {
    const resolver = vi.fn(async () => [{ id: "c1", phone: "+1" }]);
    const store = makeStore(resolver);
    const list = (store.proxy as any).users.items[0].contacts;

    void list.items; // lazily trigger the resolve
    await flush();

    expect(list.dirty).toBe(false);

    list.add({ id: "c2", phone: "+2" });
    expect(list.dirty).toBe(true);
  });

  it("reset() restores the initial membership and clears dirty", async () => {
    const resolver = vi.fn(async () => [{ id: "c1", phone: "+1" }]);
    const store = makeStore(resolver);
    const list = (store.proxy as any).users.items[0].contacts;

    void list.items;
    await flush();
    expect(list.getValues()).toEqual([{ id: "c1", phone: "+1" }]);

    store.set({ id: "c2", phone: "+2" });
    list.add("c2");
    expect(list.dirty).toBe(true);

    store.reset();

    expect(list.dirty).toBe(false);
    expect(list.getValues()).toEqual([{ id: "c1", phone: "+1" }]);
    // the owner's getValues rolled back too.
    expect((store.getValues() as any).users[0].contacts).toEqual([{ id: "c1", phone: "+1" }]);
  });
});
