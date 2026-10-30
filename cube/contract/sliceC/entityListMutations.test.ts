/**
 * Tests for per-entity nested list mutations + ownership.
 *
 * Ported from store/entityListMutations.test.ts, which drove the storage layer
 * directly (buildListProxy over an EntityListState, triggerEntityListResolve).
 * Here the same rules go through the public surface: a root `users` list whose
 * template carries the per-entity `contacts` list, reached as
 * `users.items[0].contacts`.
 *
 *   - add(values) creates a child with an owner reference and adds it to the membership;
 *   - add(id) adds an existing entity; add of a missing id → error;
 *   - remove drops from the membership, does NOT touch the registry or other lists;
 *   - setItems replaces the membership and sets the owner;
 *   - delete(ownerId) cascade-deletes the children (no orphans or leaks);
 *   - a child with two owners: add(id) re-parents the owner; deleting the
 *     first owner leaves the re-parented child alone;
 *   - reset() restores the initial membership;
 *   - a mutation bumps only its own list's version (isolation).
 */

import { describe, it, expect, vi } from "vitest";
import { Palistor, defineList } from "@impl";
import { CONFIG_NODE, LIST_STATE } from "../../../store/constants";

/**
 * Contract shim: store keys subscriptions and versions by its internal objects
 * (the ListState of a list, the entity leaf node of a field), cube by the
 * public node itself. Both implementations answer the same key through this.
 */
const trackKey = (node: any): object => node[LIST_STATE] ?? node[CONFIG_NODE] ?? node;

/**
 * Contract helper: store keeps the owner link on its entity node
 * (`entityRegistry.get(id).owner`), cube answers `entityRegistry.ownerOf(id)`.
 */
const ownerOf = (store: any, id: string) =>
  store.entityRegistry.ownerOf?.(id) ?? store.entityRegistry.get(id)?.owner;

const idsOf = (list: any): string[] => list.items.map((i: any) => i.id);

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
  const listNode = (store.rootConfig as any).users[0].contacts as object;
  /** The per-entity contacts list of a user already in the registry. */
  const contactsOf = (id: string) => {
    const users = (store.proxy as any).users;
    if (!users.getById(id)) users.add(id);
    return users.getById(id).contacts;
  };
  return { store, listNode, contactsOf };
}

describe("per-entity list mutations (C2)", () => {
  it("add(values) creates a child with an owner reference and adds it to the membership", () => {
    const { store, listNode, contactsOf } = makeStore();
    store.set({ id: "u1", name: "Alice" });

    const list = contactsOf("u1");
    list.add({ id: "c1", phone: "+1" });

    expect(idsOf(list)).toEqual(["c1"]);

    expect(ownerOf(store, "c1")).toEqual({ ownerId: "u1", ownerListNode: listNode });
    // the owner link is not part of the entity's data.
    expect(Object.keys(store.entityRegistry.get("c1")!)).not.toContain("owner");
    expect([...store.entityRegistry.getChildrenByOwner("u1")!]).toEqual(["c1"]);
    // the child is actually registered — accessible via the proxy.
    expect(list.getById("c1").phone.value).toBe("+1");
  });

  it("add(values) without an id generates one and doesn't duplicate the entity", () => {
    const { store, contactsOf } = makeStore();
    store.set({ id: "u1", name: "Alice" });
    const list = contactsOf("u1");
    const before = store.entityRegistry.size;

    list.add({ phone: "+9" });

    expect(store.entityRegistry.size).toBe(before + 1);
    expect(list.length).toBe(1);
  });

  it("add(id) adds an existing entity; a missing id → error", () => {
    const { store, listNode, contactsOf } = makeStore();
    store.set([{ id: "u1", name: "Alice" }, { id: "c1", phone: "+1" }]);

    const list = contactsOf("u1");
    list.add("c1");
    expect(idsOf(list)).toEqual(["c1"]);
    expect(ownerOf(store, "c1")).toEqual({ ownerId: "u1", ownerListNode: listNode });

    expect(() => list.add("ghost")).toThrow(/not found/i);
    // a repeated add of the same id — no duplicates.
    list.add("c1");
    expect(idsOf(list)).toEqual(["c1"]);
  });

  it("remove drops from the membership, does NOT delete the entity or touch other lists", async () => {
    const resolver = vi.fn(async (values: any) =>
      values.id === "u1"
        ? [{ id: "c1", phone: "+1" }, { id: "c2", phone: "+2" }]
        : [{ id: "c3", phone: "+3" }],
    );
    const { store, contactsOf } = makeStore(resolver);
    store.set([{ id: "u1", name: "Alice" }, { id: "u2", name: "Bob" }]);

    const list1 = contactsOf("u1");
    const list2 = contactsOf("u2");
    void list1.items;
    void list2.items;
    await flush();

    list1.remove("c1");

    expect(idsOf(list1)).toEqual(["c2"]);
    // the entity stays in the registry (can be reused).
    expect(store.entityRegistry.has("c1")).toBe(true);
    // the other owner is unaffected.
    expect(idsOf(list2)).toEqual(["c3"]);

    // removing a missing one — no-op.
    list1.remove("nope");
    expect(idsOf(list1)).toEqual(["c2"]);
  });

  it("setItems replaces the membership, sets the owner and validates existence", () => {
    const { store, contactsOf } = makeStore();
    store.set([
      { id: "u1", name: "Alice" },
      { id: "c1", phone: "+1" },
      { id: "c2", phone: "+2" },
    ]);

    const list = contactsOf("u1");
    list.setItems(["c2", "c1"]);

    expect(idsOf(list)).toEqual(["c2", "c1"]);
    expect(ownerOf(store, "c1").ownerId).toBe("u1");
    expect(ownerOf(store, "c2").ownerId).toBe("u1");

    expect(() => list.setItems(["ghost"])).toThrow(/not found/i);
  });

  it("delete(ownerId) cascade-deletes the children without orphans", async () => {
    const resolver = vi.fn(async () => [
      { id: "c1", phone: "+1" },
      { id: "c2", phone: "+2" },
    ]);
    const { store, contactsOf } = makeStore(resolver);
    store.set({ id: "u1", name: "Alice" });

    void contactsOf("u1").items;
    await flush();

    expect(store.entityRegistry.has("c1")).toBe(true);
    expect(store.entityRegistry.has("c2")).toBe(true);

    store.delete("u1");

    expect(store.entityRegistry.has("u1")).toBe(false);
    expect(store.entityRegistry.has("c1")).toBe(false);
    expect(store.entityRegistry.has("c2")).toBe(false);
    // the owner index is cleaned up.
    expect(store.entityRegistry.getChildrenByOwner("u1")).toBeUndefined();
    // and the root list no longer shows the owner.
    expect((store.proxy as any).users.length).toBe(0);
  });

  it("a child with two owners: add(id) re-parents; deleting the first owner leaves the child", async () => {
    const resolver = vi.fn(async (values: any) => (values.id === "u1" ? [{ id: "c1", phone: "+1" }] : []));
    const { store, contactsOf } = makeStore(resolver);
    store.set([{ id: "u1", name: "Alice" }, { id: "u2", name: "Bob" }]);

    void contactsOf("u1").items;
    await flush();
    expect(ownerOf(store, "c1").ownerId).toBe("u1");

    // u2 takes c1 over (the "one owner" model): the owner is re-parented.
    const list2 = contactsOf("u2");
    list2.add("c1");
    expect(ownerOf(store, "c1").ownerId).toBe("u2");
    expect([...(store.entityRegistry.getChildrenByOwner("u1") ?? [])]).not.toContain("c1");
    expect([...store.entityRegistry.getChildrenByOwner("u2")!]).toContain("c1");

    // deleting u1 must not remove c1 — it belongs to u2.
    store.delete("u1");
    expect(store.entityRegistry.has("c1")).toBe(true);

    // deleting u2 cascade-deletes c1.
    store.delete("u2");
    expect(store.entityRegistry.has("c1")).toBe(false);
  });

  it("reset() restores the list's initial membership", async () => {
    const resolver = vi.fn(async () => [{ id: "c1", phone: "+1" }]);
    const { store, contactsOf } = makeStore(resolver);
    store.set([{ id: "u1", name: "Alice" }, { id: "c2", phone: "+2" }]);

    const list = contactsOf("u1");
    void list.items;
    await flush();

    list.add("c2");
    expect(idsOf(list)).toEqual(["c1", "c2"]);

    store.reset();

    expect(idsOf(list)).toEqual(["c1"]);
  });

  it("a mutation bumps only its own list's version (isolation)", async () => {
    const { store, contactsOf } = makeStore();
    store.set([
      { id: "u1", name: "Alice" },
      { id: "u2", name: "Bob" },
      { id: "x", phone: "+9" },
    ]);

    const listA = contactsOf("u1");
    const listB = contactsOf("u2");
    const vA = store.getNodeVersion(trackKey(listA));
    const vB = store.getNodeVersion(trackKey(listB));

    listA.add("x");

    expect(store.getNodeVersion(trackKey(listA))).toBeGreaterThan(vA);
    expect(store.getNodeVersion(trackKey(listB))).toBe(vB);
  });
});
