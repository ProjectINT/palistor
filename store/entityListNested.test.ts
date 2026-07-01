/**
 * Тесты nested-of-nested per-entity списков (вариант C, фаза C4).
 *
 * Покрываем две оси вложенности:
 *
 *  1. **Entity-в-entity** (основная цель C4): `users[*].contacts[*].emails[*]`.
 *     Каждый уровень — отдельная entity со своим списком. Работает «почти
 *     автоматически» за счёт рекурсивных хелперов C1–C3; здесь фиксируем
 *     каскад на 3 уровня, изоляцию мутаций и tracking-версий на глубине.
 *
 *  2. **List-внутри-nested-группы** (закрытый в C4 блокер): список объявлен
 *     внутри структурной группы (`profile.contacts`), которая НЕ является
 *     отдельной entity. До C4 `buildEntityProjectionProxy` сбрасывал владельца
 *     при рекурсии в группу → список получал неверного владельца и возвращал
 *     undefined. Теперь настоящий owner протаскивается через рекурсию.
 */

import { describe, it, expect, vi } from "vitest";
import { Palistor } from "./store";
import { defineList } from "./defineList";

function flush() {
  return new Promise<void>((r) => setTimeout(r, 0));
}

// ─── Ось 1: entity → entity → entity ──────────────────────────────────────────

function make3Level() {
  return new Palistor({
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
}

describe("nested-of-nested entity lists (C4)", () => {
  it("add на каждом уровне; getValues отдаёт глубокую структуру", () => {
    const store = make3Level();
    store.set({ id: "u1", name: "Alice" });
    (store.proxy as any).users.add("u1");

    const contacts = (store.proxy as any).users.items[0].contacts;
    contacts.add({ id: "c1", phone: "+1" });
    contacts.add({ id: "c2", phone: "+2" });
    contacts.items[0].emails.add({ id: "e1", addr: "a@x.io" });
    contacts.items[0].emails.add({ id: "e2", addr: "b@x.io" });
    contacts.items[1].emails.add({ id: "e3", addr: "c@x.io" });

    expect((store.getValues() as any).users).toEqual([
      {
        id: "u1",
        name: "Alice",
        contacts: [
          { id: "c1", phone: "+1", emails: [{ id: "e1", addr: "a@x.io" }, { id: "e2", addr: "b@x.io" }] },
          { id: "c2", phone: "+2", emails: [{ id: "e3", addr: "c@x.io" }] },
        ],
      },
    ]);
  });

  it("list.getValues() на каждом уровне отдаёт свой состав", () => {
    const store = make3Level();
    store.set({ id: "u1", name: "Alice" });
    (store.proxy as any).users.add("u1");
    const contacts = (store.proxy as any).users.items[0].contacts;
    contacts.add({ id: "c1", phone: "+1" });
    contacts.items[0].emails.add({ id: "e1", addr: "a@x.io" });

    expect(contacts.getValues()).toEqual([
      { id: "c1", phone: "+1", emails: [{ id: "e1", addr: "a@x.io" }] },
    ]);
    expect(contacts.items[0].emails.getValues()).toEqual([{ id: "e1", addr: "a@x.io" }]);
  });

  it("каскадное удаление через 3 уровня: delete(u1) уносит contacts И emails", () => {
    const store = make3Level();
    store.set({ id: "u1", name: "Alice" });
    (store.proxy as any).users.add("u1");
    const contacts = (store.proxy as any).users.items[0].contacts;
    contacts.add({ id: "c1", phone: "+1" });
    contacts.add({ id: "c2", phone: "+2" });
    contacts.items[0].emails.add({ id: "e1", addr: "a@x.io" });
    contacts.items[1].emails.add({ id: "e2", addr: "b@x.io" });

    // Все 5 entity (u1 + c1,c2 + e1,e2) в реестре.
    for (const id of ["u1", "c1", "c2", "e1", "e2"]) {
      expect(store.entityRegistry.has(id)).toBe(true);
    }

    store.delete("u1");

    // Каскад снёс всё дерево, без orphan'ов.
    for (const id of ["u1", "c1", "c2", "e1", "e2"]) {
      expect(store.entityRegistry.has(id)).toBe(false);
    }
    expect(store.entityRegistry.getChildrenByOwner("u1")).toBeUndefined();
    expect(store.entityRegistry.getChildrenByOwner("c1")).toBeUndefined();
  });

  it("каскад одного поддерева не задевает соседнее (delete(c1) не трогает c2/e2)", () => {
    const store = make3Level();
    store.set({ id: "u1", name: "Alice" });
    (store.proxy as any).users.add("u1");
    const contacts = (store.proxy as any).users.items[0].contacts;
    contacts.add({ id: "c1", phone: "+1" });
    contacts.add({ id: "c2", phone: "+2" });
    contacts.items[0].emails.add({ id: "e1", addr: "a@x.io" });
    contacts.items[1].emails.add({ id: "e2", addr: "b@x.io" });

    store.delete("c1");

    expect(store.entityRegistry.has("c1")).toBe(false);
    expect(store.entityRegistry.has("e1")).toBe(false); // каскад вглубь
    expect(store.entityRegistry.has("c2")).toBe(true);
    expect(store.entityRegistry.has("e2")).toBe(true);
  });

  it("изоляция мутаций на глубине: emails двух contacts независимы", () => {
    const store = make3Level();
    store.set({ id: "u1", name: "Alice" });
    (store.proxy as any).users.add("u1");
    const contacts = (store.proxy as any).users.items[0].contacts;
    contacts.add({ id: "c1", phone: "+1" });
    contacts.add({ id: "c2", phone: "+2" });

    contacts.items[0].emails.add({ id: "e1", addr: "a@x.io" });

    expect(contacts.items[0].emails.getValues()).toEqual([{ id: "e1", addr: "a@x.io" }]);
    expect(contacts.items[1].emails.getValues()).toEqual([]);
    expect(contacts.items[1].emails.length).toBe(0);
  });

  it("изоляция tracking-версий на глубине: мутация c1.emails не бампит c2.emails", () => {
    const store = make3Level();
    store.set({ id: "u1", name: "Alice" });
    (store.proxy as any).users.add("u1");
    const contacts = (store.proxy as any).users.items[0].contacts;
    contacts.add({ id: "c1", phone: "+1" });
    contacts.add({ id: "c2", phone: "+2" });

    const c1 = store.entityRegistry.get("c1")!;
    const c2 = store.entityRegistry.get("c2")!;
    const emailsNode = (store.rootConfig as any).users[0].contacts[0].emails as object;
    const elsC1 = store.entityRegistry.getOrCreateEntityListState(c1, emailsNode);
    const elsC2 = store.entityRegistry.getOrCreateEntityListState(c2, emailsNode);

    const vC2before = store.getNodeVersion(elsC2 as unknown as object);

    contacts.items[0].emails.add({ id: "e1", addr: "a@x.io" });

    expect(store.getNodeVersion(elsC1 as unknown as object)).toBeGreaterThan(0);
    expect(store.getNodeVersion(elsC2 as unknown as object)).toBe(vC2before);
  });

  it("resolver child-list тоже работает на 2-м уровне (contacts резолвятся)", async () => {
    const contactsResolver = vi.fn(async (v: any) =>
      v.id === "u1" ? [{ id: "c1", phone: "+1" }] : [],
    );
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
                emails: defineList({ template: { id: { value: "" }, addr: { value: "" } } }),
              },
              resolve: { resolver: contactsResolver, onError: vi.fn() },
            }),
          },
        }),
      } as any,
    });
    store.set({ id: "u1", name: "Alice" });
    (store.proxy as any).users.add("u1");

    void (store.proxy as any).users.items[0].contacts.items; // lazy trigger
    await flush();

    expect(contactsResolver).toHaveBeenCalledTimes(1);
    // У зарезолвленного contact c1 свой emails-список работает.
    const c1List = (store.proxy as any).users.items[0].contacts.items[0];
    c1List.emails.add({ id: "e1", addr: "a@x.io" });
    expect(c1List.emails.getValues()).toEqual([{ id: "e1", addr: "a@x.io" }]);
  });
});

// ─── Ось 2: список внутри nested-группы (закрытый блокер) ──────────────────────

function makeGroupListStore() {
  return new Palistor({
    config: {
      users: defineList({
        template: {
          id: { value: "" },
          name: { value: "" },
          profile: {
            bio: { value: "" },
            contacts: defineList({
              template: { id: { value: "" }, phone: { value: "" } },
            }),
          },
        },
      }),
    } as any,
  });
}

describe("list внутри nested-группы — owner = root entity (C4 блокер)", () => {
  it("profile.contacts — рабочий list-proxy (не undefined), owner = root entity", () => {
    const store = makeGroupListStore();
    store.set({ id: "u1", name: "Alice", profile: { bio: "hi" } });
    (store.proxy as any).users.add("u1");

    const list = (store.proxy as any).users.items[0].profile.contacts;
    expect(list).toBeDefined();
    expect(typeof list.add).toBe("function");

    list.add({ id: "c1", phone: "+1" });

    // owner проставлен на ROOT entity (u1), а не на группу profile.
    expect(store.entityRegistry.get("c1")!.owner).toEqual({
      ownerId: "u1",
      ownerListNode: (store.rootConfig as any).users[0].profile.contacts,
    });
    expect([...store.entityRegistry.getChildrenByOwner("u1")!]).toEqual(["c1"]);
  });

  it("getValues материализует список во вложенный path (users[0].profile.contacts)", () => {
    const store = makeGroupListStore();
    store.set({ id: "u1", name: "Alice", profile: { bio: "hi" } });
    (store.proxy as any).users.add("u1");
    (store.proxy as any).users.items[0].profile.contacts.add({ id: "c1", phone: "+1" });

    expect((store.getValues() as any).users).toEqual([
      { id: "u1", name: "Alice", profile: { bio: "hi", contacts: [{ id: "c1", phone: "+1" }] } },
    ]);
  });

  it("entityProxy.values тоже содержит вложенный profile.contacts", () => {
    const store = makeGroupListStore();
    store.set({ id: "u1", name: "Alice", profile: { bio: "hi" } });
    (store.proxy as any).users.add("u1");
    (store.proxy as any).users.items[0].profile.contacts.add({ id: "c1", phone: "+1" });

    expect((store.proxy as any).users.items[0].values).toEqual({
      id: "u1",
      name: "Alice",
      profile: { bio: "hi", contacts: [{ id: "c1", phone: "+1" }] },
    });
  });

  it("каскадное удаление работает для списка в группе", () => {
    const store = makeGroupListStore();
    store.set({ id: "u1", name: "Alice", profile: { bio: "hi" } });
    (store.proxy as any).users.add("u1");
    (store.proxy as any).users.items[0].profile.contacts.add({ id: "c1", phone: "+1" });

    expect(store.entityRegistry.has("c1")).toBe(true);
    store.delete("u1");
    expect(store.entityRegistry.has("c1")).toBe(false);
  });

  it("изоляция между владельцами: profile.contacts разных users независимы", () => {
    const store = makeGroupListStore();
    store.set([
      { id: "u1", name: "Alice", profile: { bio: "a" } },
      { id: "u2", name: "Bob", profile: { bio: "b" } },
    ]);
    (store.proxy as any).users.add("u1");
    (store.proxy as any).users.add("u2");

    (store.proxy as any).users.items[0].profile.contacts.add({ id: "c1", phone: "+1" });

    expect((store.proxy as any).users.items[0].profile.contacts.getValues()).toEqual([
      { id: "c1", phone: "+1" },
    ]);
    expect((store.proxy as any).users.items[1].profile.contacts.getValues()).toEqual([]);
    expect((store.proxy as any).users.items[1].profile.contacts.length).toBe(0);
  });

  it("persist round-trip переживает список в nested-группе", async () => {
    const storage = new Map<string, string>();
    const driver = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    };

    const store1 = makeGroupListStore();
    store1.set({ id: "u1", name: "Alice", profile: { bio: "hi" } });
    (store1.proxy as any).users.add("u1");
    (store1.proxy as any).users.items[0].profile.contacts.add({ id: "c1", phone: "+1" });

    await store1.persist.enable({ key: "g", driver, debounce: 0 });
    await store1.persist.flush();

    const store2 = makeGroupListStore();
    await store2.persist.enable({ key: "g", driver });

    expect(store2.getValues()).toEqual(store1.getValues());
    expect((store2.proxy as any).users.items[0].profile.contacts.getValues()).toEqual([
      { id: "c1", phone: "+1" },
    ]);
    // Owner восстановлен → каскад работает после reload.
    expect(store2.entityRegistry.get("c1")!.owner!.ownerId).toBe("u1");
    store2.delete("u1");
    expect(store2.entityRegistry.has("c1")).toBe(false);
  });
});
