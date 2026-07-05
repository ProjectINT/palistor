/**
 * Tests for per-entity nested list resolve.
 *
 * Exercises the storage layer directly (no React):
 *   - the resolver is called per owner with the owner's correct flat snapshot;
 *   - lists/owner do NOT leak into parentValues (non-enumerable);
 *   - a repeated trigger for the same entity doesn't call the resolver (cache hit);
 *   - two owners → independent itemIds;
 *   - tracking-version isolation between owners of one listConfigNode.
 *
 * Mutations (add/remove/setItems) and cascade deletion are covered in
 * entityListMutations.test.ts.
 */

import { describe, it, expect, vi } from "vitest";
import { Palistor } from "./store";
import { defineList } from "./defineList";

function flush() {
  return new Promise<void>((r) => setTimeout(r, 0));
}

function makeStore(resolver: (...a: any[]) => any) {
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
          resolve: { resolver, onError: vi.fn() },
        }),
      },
    } as any,
  });
  const listNode = (store.rootConfig as any).editUser.contacts as object;
  return { store, listNode };
}

describe("per-entity list resolve (C1)", () => {
  it("the resolver receives the owner's flat snapshot; lists/owner don't leak", async () => {
    const seen: any[] = [];
    const resolver = vi.fn(async (values: any) => {
      seen.push(values);
      return [{ id: "c1", phone: "+1" }];
    });
    const { store, listNode } = makeStore(resolver);

    store.set({ id: "u1", name: "Alice" });
    const u1 = store.entityRegistry.get("u1")!;

    store.resolveManager.triggerEntityListResolve("u1", listNode as any, u1);
    await flush();

    expect(resolver).toHaveBeenCalledTimes(1);
    const parentValues = seen[0];
    expect(parentValues.id).toBe("u1");
    expect(parentValues.name).toBe("Alice");
    // Non-enumerable regression: lists/owner must NOT land in the snapshot.
    expect("lists" in parentValues).toBe(false);
    expect("owner" in parentValues).toBe(false);
    expect(Object.keys(parentValues).sort()).toEqual(["id", "name"]);
  });

  it("ingests children with the owner reference and fills itemIds", async () => {
    const resolver = vi.fn(async () => [
      { id: "c1", phone: "+1" },
      { id: "c2", phone: "+2" },
    ]);
    const { store, listNode } = makeStore(resolver);

    store.set({ id: "u1", name: "Alice" });
    const u1 = store.entityRegistry.get("u1")!;

    store.resolveManager.triggerEntityListResolve("u1", listNode as any, u1);
    await flush();

    const els = store.entityRegistry.getOrCreateEntityListState(u1, listNode);
    expect(els.itemIds).toEqual(["c1", "c2"]);
    expect(els.initialItemIds).toEqual(["c1", "c2"]);

    // the owner reference is set and indexed (non-enumerable).
    const c1 = store.entityRegistry.get("c1")!;
    expect(c1.owner).toEqual({ ownerId: "u1", ownerListNode: listNode });
    expect(Object.keys(c1)).not.toContain("owner");
    expect([...store.entityRegistry.getChildrenByOwner("u1")!]).toEqual(["c1", "c2"]);
  });

  it("a repeated trigger for the same entity doesn't call the resolver (cache hit)", async () => {
    const resolver = vi.fn(async () => [{ id: "c1", phone: "+1" }]);
    const { store, listNode } = makeStore(resolver);

    store.set({ id: "u1", name: "Alice" });
    const u1 = store.entityRegistry.get("u1")!;

    store.resolveManager.triggerEntityListResolve("u1", listNode as any, u1);
    await flush();
    store.resolveManager.triggerEntityListResolve("u1", listNode as any, u1);
    await flush();

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(store.resolveManager.entityStates.get("u1", listNode)?.status).toBe("resolved");
  });

  it("two owners → two independent itemIds", async () => {
    const resolver = vi.fn(async (values: any) =>
      values.id === "u1"
        ? [{ id: "c1", phone: "+1" }]
        : [{ id: "c2", phone: "+2" }, { id: "c3", phone: "+3" }],
    );
    const { store, listNode } = makeStore(resolver);

    store.set([{ id: "u1", name: "Alice" }, { id: "u2", name: "Bob" }]);
    const u1 = store.entityRegistry.get("u1")!;
    const u2 = store.entityRegistry.get("u2")!;

    store.resolveManager.triggerEntityListResolve("u1", listNode as any, u1);
    store.resolveManager.triggerEntityListResolve("u2", listNode as any, u2);
    await flush();

    expect(store.entityRegistry.getOrCreateEntityListState(u1, listNode).itemIds).toEqual(["c1"]);
    expect(store.entityRegistry.getOrCreateEntityListState(u2, listNode).itemIds).toEqual(["c2", "c3"]);
    // Different EntityListState objects on different owners.
    expect(store.entityRegistry.getOrCreateEntityListState(u1, listNode)).not.toBe(
      store.entityRegistry.getOrCreateEntityListState(u2, listNode),
    );
  });

  it("isolation: one owner's resolve doesn't bump the other's list version", async () => {
    const resolver = vi.fn(async () => [{ id: "c1", phone: "+1" }]);
    const { store, listNode } = makeStore(resolver);

    store.set([{ id: "u1", name: "Alice" }, { id: "u2", name: "Bob" }]);
    const u1 = store.entityRegistry.get("u1")!;
    const u2 = store.entityRegistry.get("u2")!;

    const elsA = store.entityRegistry.getOrCreateEntityListState(u1, listNode);
    const elsB = store.entityRegistry.getOrCreateEntityListState(u2, listNode);

    const vB_before = store.getNodeVersion(elsB as unknown as object);

    store.resolveManager.triggerEntityListResolve("u1", listNode as any, u1);
    await flush();

    expect(store.getNodeVersion(elsA as unknown as object)).toBeGreaterThan(0);
    expect(store.getNodeVersion(elsB as unknown as object)).toBe(vB_before);
  });

  it.todo(
    "an owner deps change → re-resolve (deps-driven re-resolve is planned)",
  );
});
