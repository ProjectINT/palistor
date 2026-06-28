/**
 * Тесты per-entity nested list mutations + ownership (вариант C, фаза C2).
 *
 * Проверяем storage-слой напрямую (без React):
 *   - add(values) создаёт child с owner-ссылкой и добавляет в itemIds;
 *   - add(id) добавляет существующую entity; add несуществующего id → ошибка;
 *   - remove убирает из itemIds, НЕ трогает registry и другие списки;
 *   - setItems заменяет состав и проставляет owner;
 *   - delete(ownerId) каскадно удаляет children (без orphan'ов и утечек);
 *   - child с двумя владельцами: add(id) переадресует owner, delete первого
 *     владельца не трогает переадресованного child;
 *   - reset() восстанавливает initial-состав;
 *   - мутация бампает версию только своего EntityListState (изоляция).
 */

import { describe, it, expect, vi } from "vitest";
import { Palistor } from "./store";
import { defineList } from "./defineList";
import { buildListProxy } from "./buildProxy/buildListProxy";

/**
 * Шим под прежнюю сигнатуру теста: единый buildListProxy принимает ListState.
 * Per-entity ListState достаём из реестра по паре (owner, listNode).
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
  it("add(values) создаёт child с owner-ссылкой и добавляет в itemIds", () => {
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
    // child реально зарегистрирован — доступен через proxy.
    expect(list.getById("c1").phone.value).toBe("+1");
  });

  it("add(values) без id генерирует id и не дублирует entity", () => {
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

  it("add(id) добавляет существующую entity; несуществующий id → ошибка", () => {
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
    // повторный add того же id — без дублей.
    list.add("c1");
    expect(store.entityRegistry.getOrCreateEntityListState(u1, listNode).itemIds).toEqual(["c1"]);
  });

  it("remove убирает из itemIds, НЕ удаляет entity и не трогает другие списки", async () => {
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
    // entity осталась в registry (может переиспользоваться).
    expect(store.entityRegistry.has("c1")).toBe(true);
    // другой владелец не затронут.
    expect(store.entityRegistry.getOrCreateEntityListState(u2, listNode).itemIds).toEqual(["c3"]);

    // remove несуществующего — no-op.
    list1.remove("nope");
    expect(store.entityRegistry.getOrCreateEntityListState(u1, listNode).itemIds).toEqual(["c2"]);
  });

  it("setItems заменяет состав, проставляет owner и валидирует существование", () => {
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

  it("delete(ownerId) каскадно удаляет children без orphan'ов", async () => {
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
    // owner-индекс вычищен.
    expect(store.entityRegistry.getChildrenByOwner("u1")).toBeUndefined();
  });

  it("child с двумя владельцами: add(id) переадресует, delete первого не трогает child", async () => {
    const resolver = vi.fn(async () => [{ id: "c1", phone: "+1" }]);
    const { store, listNode } = makeStore(resolver);
    store.set([{ id: "u1", name: "Alice" }, { id: "u2", name: "Bob" }]);
    const u1 = store.entityRegistry.get("u1")!;
    const u2 = store.entityRegistry.get("u2")!;

    store.resolveManager.triggerEntityListResolve("u1", listNode as any, u1);
    await flush();
    expect(store.entityRegistry.get("c1")!.owner!.ownerId).toBe("u1");

    // u2 забирает c1 себе (модель «один владелец»): owner переадресуется.
    const list2 = buildEntityListProxy(u2, listNode as any, store as any) as any;
    list2.add("c1");
    expect(store.entityRegistry.get("c1")!.owner!.ownerId).toBe("u2");
    expect([...(store.entityRegistry.getChildrenByOwner("u1") ?? [])]).not.toContain("c1");
    expect([...store.entityRegistry.getChildrenByOwner("u2")!]).toContain("c1");

    // delete u1 не должен удалять c1 — он принадлежит u2.
    store.delete("u1");
    expect(store.entityRegistry.has("c1")).toBe(true);

    // delete u2 — каскадно удаляет c1.
    store.delete("u2");
    expect(store.entityRegistry.has("c1")).toBe(false);
  });

  it("reset() восстанавливает initial-состав списка", async () => {
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

  it("мутация бампает версию только своего EntityListState (изоляция)", async () => {
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
