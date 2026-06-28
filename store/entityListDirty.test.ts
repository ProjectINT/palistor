/**
 * Тесты dirty для per-entity nested list (вариант C, фаза C3).
 *
 * Проверяем:
 *   - list.dirty по составу (itemIds vs initialItemIds);
 *   - dirty владельца (entityProxy.dirty) агрегирует list-composition;
 *   - add/remove влияют на dirty; возврат к initial → dirty=false;
 *   - reset() восстанавливает initial-состав и снимает dirty.
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
  it("пустой нетронутый список не dirty", () => {
    const store = makeStore();
    const list = (store.proxy as any).users.items[0].contacts;
    expect(list.dirty).toBe(false);
  });

  it("add делает список dirty, владельца — тоже", () => {
    const store = makeStore();
    const u1 = (store.proxy as any).users.items[0];
    const list = u1.contacts;

    expect(u1.dirty).toBe(false);
    list.add({ id: "c1", phone: "+1" });

    expect(list.dirty).toBe(true);
    expect(u1.dirty).toBe(true);
  });

  it("возврат состава к initial снимает dirty", () => {
    const store = makeStore();
    const list = (store.proxy as any).users.items[0].contacts;

    list.add({ id: "c1", phone: "+1" });
    expect(list.dirty).toBe(true);

    list.remove("c1");
    // itemIds снова пуст == initial → не dirty.
    expect(list.dirty).toBe(false);
    expect((store.proxy as any).users.items[0].dirty).toBe(false);
  });

  it("после resolve список не dirty (initialItemIds синхронизирован)", async () => {
    const resolver = vi.fn(async () => [{ id: "c1", phone: "+1" }]);
    const store = makeStore(resolver);
    const list = (store.proxy as any).users.items[0].contacts;

    void list.items; // ленивый триггер resolve
    await flush();

    expect(list.dirty).toBe(false);

    list.add({ id: "c2", phone: "+2" });
    expect(list.dirty).toBe(true);
  });

  it("reset() восстанавливает initial-состав и снимает dirty", async () => {
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
    // getValues владельца тоже откатился.
    expect((store.getValues() as any).users[0].contacts).toEqual([{ id: "c1", phone: "+1" }]);
  });
});
