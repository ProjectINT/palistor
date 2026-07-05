/**
 * Tests for per-entity nested list mutations + ownership.
 *
 * Exercises the storage layer directly (no React):
 *   - add(values) creates a child with an owner reference and adds it to itemIds;
 *   - add(id) adds an existing entity; add of a missing id → error;
 *   - remove drops from itemIds, does NOT touch the registry or other lists;
 *   - setItems replaces the membership and sets the owner;
 *   - delete(ownerId) cascade-deletes the children (no orphans or leaks);
 *   - a child with two owners: add(id) re-parents the owner; deleting the
 *     first owner leaves the re-parented child alone;
 *   - reset() restores the initial membership;
 *   - a mutation bumps only its own EntityListState version (isolation).
 */

import { describe, it, expect, vi } from "vitest";
import { Palistor } from "./store";
import { defineList } from "./defineList";
import { buildListProxy } from "./buildProxy/buildListProxy";

/**
 * Shim for the old test signature: the unified buildListProxy takes a ListState.
 * The per-entity ListState is fetched from the registry by the (owner, listNode) pair.
 */
function buildEntityListProxy(owner: any, listNode: any, store: any) {
  return buildListProxy(
    store.entityRegistry.getOrCreateEntityListState(owner, listNode),
    store,
  );
}

function flush() {
  return new Promise<void>((r) => setTimeout(r, 0));
}

function makeStore(resolver?: (...a: any[]) => any) {
  const store = new Palistor({
    config: {
      editUser: {
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
    } as any,
  });
  const listNode = (store.rootConfig as any).editUser.contacts as object;
  return { store, listNode };
}

describe("per-entity list mutations (C2)", () => {
  it("add(values) creates a child with an owner reference and adds it to itemIds", () => {
    const { store, listNode } = makeStore();
    store.set({ id: "u1", name: "Alice" });
    const u1 = store.entityRegistry.get("u1")!;

    const list = buildEntityListProxy(u1, listNode as any, store as any) as any;
    list.add({ id: "c1", phone: "+1" });

    const els = store.entityRegistry.getOrCreateEntityListState(u1, listNode);
    expect(els.itemIds).toEqual(["c1"]);

    const c1 = store.entityRegistry.get("c1")!;
    expect(c1.owner).toEqual({ ownerId: "u1", ownerListNode: listNode });
    expect(Object.keys(c1)).not.toContain("owner");
    expect([...store.entityRegistry.getChildrenByOwner("u1")!]).toEqual(["c1"]);
    // the child is actually registered — accessible via the proxy.
    expect(list.getById("c1").phone.value).toBe("+1");
  });

  it("add(values) without an id generates one and doesn't duplicate the entity", () => {
    const { store, listNode } = makeStore();
    store.set({ id: "u1", name: "Alice" });
    const u1 = store.entityRegistry.get("u1")!;
    const before = store.entityRegistry.size;

    const list = buildEntityListProxy(u1, listNode as any, store as any) as any;
    list.add({ phone: "+9" });

    expect(store.entityRegistry.size).toBe(before + 1);
    const els = store.entityRegistry.getOrCreateEntityListState(u1, listNode);
    expect(els.itemIds).toHaveLength(1);
  });

  it("add(id) adds an existing entity; a missing id → error", () => {
    const { store, listNode } = makeStore();
    store.set([{ id: "u1", name: "Alice" }, { id: "c1", phone: "+1" }]);
    const u1 = store.entityRegistry.get("u1")!;

    const list = buildEntityListProxy(u1, listNode as any, store as any) as any;
    list.add("c1");
    expect(store.entityRegistry.getOrCreateEntityListState(u1, listNode).itemIds).toEqual(["c1"]);
    expect(store.entityRegistry.get("c1")!.owner).toEqual({
      ownerId: "u1",
      ownerListNode: listNode,
    });

    expect(() => list.add("ghost")).toThrow(/not found/i);
    // a repeated add of the same id — no duplicates.
    list.add("c1");
    expect(store.entityRegistry.getOrCreateEntityListState(u1, listNode).itemIds).toEqual(["c1"]);
  });

  it("remove drops from itemIds, does NOT delete the entity or touch other lists", async () => {
    const resolver = vi.fn(async (values: any) =>
      values.id === "u1"
        ? [{ id: "c1", phone: "+1" }, { id: "c2", phone: "+2" }]
        : [{ id: "c3", phone: "+3" }],
    );
    const { store, listNode } = makeStore(resolver);
    store.set([{ id: "u1", name: "Alice" }, { id: "u2", name: "Bob" }]);
    const u1 = store.entityRegistry.get("u1")!;
    const u2 = store.entityRegistry.get("u2")!;

    store.resolveManager.triggerEntityListResolve("u1", listNode as any, u1);
    store.resolveManager.triggerEntityListResolve("u2", listNode as any, u2);
    await flush();

    const list1 = buildEntityListProxy(u1, listNode as any, store as any) as any;
    list1.remove("c1");

    expect(store.entityRegistry.getOrCreateEntityListState(u1, listNode).itemIds).toEqual(["c2"]);
    // the entity stays in the registry (can be reused).
    expect(store.entityRegistry.has("c1")).toBe(true);
    // the other owner is unaffected.
    expect(store.entityRegistry.getOrCreateEntityListState(u2, listNode).itemIds).toEqual(["c3"]);

    // removing a missing one — no-op.
    list1.remove("nope");
    expect(store.entityRegistry.getOrCreateEntityListState(u1, listNode).itemIds).toEqual(["c2"]);
  });

  it("setItems replaces the membership, sets the owner and validates existence", () => {
    const { store, listNode } = makeStore();
    store.set([
      { id: "u1", name: "Alice" },
      { id: "c1", phone: "+1" },
      { id: "c2", phone: "+2" },
    ]);
    const u1 = store.entityRegistry.get("u1")!;

    const list = buildEntityListProxy(u1, listNode as any, store as any) as any;
    list.setItems(["c2", "c1"]);

    expect(store.entityRegistry.getOrCreateEntityListState(u1, listNode).itemIds).toEqual(["c2", "c1"]);
    expect(store.entityRegistry.get("c1")!.owner!.ownerId).toBe("u1");
    expect(store.entityRegistry.get("c2")!.owner!.ownerId).toBe("u1");

    expect(() => list.setItems(["ghost"])).toThrow(/not found/i);
  });

  it("delete(ownerId) cascade-deletes the children without orphans", async () => {
    const resolver = vi.fn(async () => [
      { id: "c1", phone: "+1" },
      { id: "c2", phone: "+2" },
    ]);
    const { store, listNode } = makeStore(resolver);
    store.set({ id: "u1", name: "Alice" });
    const u1 = store.entityRegistry.get("u1")!;

    store.resolveManager.triggerEntityListResolve("u1", listNode as any, u1);
    await flush();

    expect(store.entityRegistry.has("c1")).toBe(true);
    expect(store.entityRegistry.has("c2")).toBe(true);

    store.delete("u1");

    expect(store.entityRegistry.has("u1")).toBe(false);
    expect(store.entityRegistry.has("c1")).toBe(false);
    expect(store.entityRegistry.has("c2")).toBe(false);
    // the owner index is cleaned up.
    expect(store.entityRegistry.getChildrenByOwner("u1")).toBeUndefined();
  });

  it("a child with two owners: add(id) re-parents; deleting the first owner leaves the child", async () => {
    const resolver = vi.fn(async () => [{ id: "c1", phone: "+1" }]);
    const { store, listNode } = makeStore(resolver);
    store.set([{ id: "u1", name: "Alice" }, { id: "u2", name: "Bob" }]);
    const u1 = store.entityRegistry.get("u1")!;
    const u2 = store.entityRegistry.get("u2")!;

    store.resolveManager.triggerEntityListResolve("u1", listNode as any, u1);
    await flush();
    expect(store.entityRegistry.get("c1")!.owner!.ownerId).toBe("u1");

    // u2 takes c1 over (the "one owner" model): the owner is re-parented.
    const list2 = buildEntityListProxy(u2, listNode as any, store as any) as any;
    list2.add("c1");
    expect(store.entityRegistry.get("c1")!.owner!.ownerId).toBe("u2");
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
    const { store, listNode } = makeStore(resolver);
    store.set([{ id: "u1", name: "Alice" }, { id: "c2", phone: "+2" }]);
    const u1 = store.entityRegistry.get("u1")!;

    store.resolveManager.triggerEntityListResolve("u1", listNode as any, u1);
    await flush();

    const list = buildEntityListProxy(u1, listNode as any, store as any) as any;
    list.add("c2");
    expect(store.entityRegistry.getOrCreateEntityListState(u1, listNode).itemIds).toEqual(["c1", "c2"]);

    store.reset();

    expect(store.entityRegistry.getOrCreateEntityListState(u1, listNode).itemIds).toEqual(["c1"]);
  });

  it("a mutation bumps only its own EntityListState version (isolation)", async () => {
    const resolver = vi.fn(async () => [{ id: "c1", phone: "+1" }]);
    const { store, listNode } = makeStore(resolver);
    store.set([
      { id: "u1", name: "Alice" },
      { id: "u2", name: "Bob" },
      { id: "x", phone: "+9" },
    ]);
    const u1 = store.entityRegistry.get("u1")!;
    const u2 = store.entityRegistry.get("u2")!;

    const elsA = store.entityRegistry.getOrCreateEntityListState(u1, listNode);
    const elsB = store.entityRegistry.getOrCreateEntityListState(u2, listNode);
    const vA = store.getNodeVersion(elsA as unknown as object);
    const vB = store.getNodeVersion(elsB as unknown as object);

    const list1 = buildEntityListProxy(u1, listNode as any, store as any) as any;
    list1.add("x");

    expect(store.getNodeVersion(elsA as unknown as object)).toBeGreaterThan(vA);
    expect(store.getNodeVersion(elsB as unknown as object)).toBe(vB);
  });
});
