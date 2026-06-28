/**
 * Тесты per-entity nested list resolve (вариант C, фаза C1).
 *
 * Проверяем storage-слой напрямую (без React):
 *   - resolver вызывается per-owner с правильным flat snapshot владельца;
 *   - lists/owner НЕ протекают в parentValues (non-enumerable);
 *   - повторный trigger той же entity не дёргает resolver (кэш hit);
 *   - два владельца → независимые itemIds;
 *   - изоляция tracking-версии между владельцами одного listConfigNode.
 *
 * Мутации (add/remove/setItems) и каскадное удаление покрыты в
 * entityListMutations.test.ts (фаза C2).
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
  it("resolver получает flat snapshot владельца; lists/owner не протекают", async () => {
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
    // Регресс на non-enumerable: lists/owner НЕ должны попасть в snapshot.
    expect("lists" in parentValues).toBe(false);
    expect("owner" in parentValues).toBe(false);
    expect(Object.keys(parentValues).sort()).toEqual(["id", "name"]);
  });

  it("заливает children с owner-ссылкой и заполняет itemIds", async () => {
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

    // owner-ссылка проставлена и проиндексирована (non-enumerable).
    const c1 = store.entityRegistry.get("c1")!;
    expect(c1.owner).toEqual({ ownerId: "u1", ownerListNode: listNode });
    expect(Object.keys(c1)).not.toContain("owner");
    expect([...store.entityRegistry.getChildrenByOwner("u1")!]).toEqual(["c1", "c2"]);
  });

  it("повторный trigger той же entity не дёргает resolver (кэш hit)", async () => {
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

  it("два владельца → два независимых itemIds", async () => {
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
    // Разные EntityListState-объекты на разных владельцах.
    expect(store.entityRegistry.getOrCreateEntityListState(u1, listNode)).not.toBe(
      store.entityRegistry.getOrCreateEntityListState(u2, listNode),
    );
  });

  it("изоляция: resolve одного владельца не бампит версию списка другого", async () => {
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
    "смена deps владельца → re-resolve (deps-driven re-resolve появится в следующей C-фазе)",
  );
});
