/**
 * Tests for nested-of-nested per-entity lists.
 *
 * Two nesting axes are covered:
 *
 *  1. **Entity-in-entity** (the main target): `users[*].contacts[*].emails[*]`.
 *     Every level is a separate entity with its own list. Works "almost
 *     automatically" thanks to the recursive helpers; here we pin down the
 *     3-level cascade, mutation isolation and tracking-version isolation at depth.
 *
 *  2. **List inside a nested group** (a fixed blocker): the list is declared
 *     inside a structural group (`profile.contacts`) that is NOT a separate
 *     entity. Previously `buildEntityProjectionProxy` reset the owner when
 *     recursing into a group → the list got the wrong owner and returned
 *     undefined. Now the real owner is threaded through the recursion.
 */

import { describe, it, expect, vi } from "vitest";
import { Palistor } from "./store";
import { defineList } from "./defineList";

function flush() {
  return new Promise<void>((r) => setTimeout(r, 0));
}

// ─── Axis 1: entity → entity → entity ──────────────────────────────────────────

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
  it("add at every level; getValues returns the deep structure", () => {
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

  it("list.getValues() at every level returns its own membership", () => {
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

  it("cascade deletion through 3 levels: delete(u1) takes contacts AND emails", () => {
    const store = make3Level();
    store.set({ id: "u1", name: "Alice" });
    (store.proxy as any).users.add("u1");
    const contacts = (store.proxy as any).users.items[0].contacts;
    contacts.add({ id: "c1", phone: "+1" });
    contacts.add({ id: "c2", phone: "+2" });
    contacts.items[0].emails.add({ id: "e1", addr: "a@x.io" });
    contacts.items[1].emails.add({ id: "e2", addr: "b@x.io" });

    // All 5 entities (u1 + c1,c2 + e1,e2) are in the registry.
    for (const id of ["u1", "c1", "c2", "e1", "e2"]) {
      expect(store.entityRegistry.has(id)).toBe(true);
    }

    store.delete("u1");

    // The cascade removed the whole tree, no orphans.
    for (const id of ["u1", "c1", "c2", "e1", "e2"]) {
      expect(store.entityRegistry.has(id)).toBe(false);
    }
    expect(store.entityRegistry.getChildrenByOwner("u1")).toBeUndefined();
    expect(store.entityRegistry.getChildrenByOwner("c1")).toBeUndefined();
  });

  it("a subtree cascade does not touch its sibling (delete(c1) leaves c2/e2 alone)", () => {
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
    expect(store.entityRegistry.has("e1")).toBe(false); // deep cascade
    expect(store.entityRegistry.has("c2")).toBe(true);
    expect(store.entityRegistry.has("e2")).toBe(true);
  });

  it("mutation isolation at depth: two contacts' emails are independent", () => {
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

  it("tracking-version isolation at depth: mutating c1.emails does not bump c2.emails", () => {
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

  it("a child-list resolver also works at level 2 (contacts get resolved)", async () => {
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
    // The resolved contact c1 has a working emails list of its own.
    const c1List = (store.proxy as any).users.items[0].contacts.items[0];
    c1List.emails.add({ id: "e1", addr: "a@x.io" });
    expect(c1List.emails.getValues()).toEqual([{ id: "e1", addr: "a@x.io" }]);
  });
});

// ─── Axis 2: a list inside a nested group (fixed blocker) ──────────────────────

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

describe("a list inside a nested group — owner = root entity", () => {
  it("profile.contacts is a working list proxy (not undefined), owner = root entity", () => {
    const store = makeGroupListStore();
    store.set({ id: "u1", name: "Alice", profile: { bio: "hi" } });
    (store.proxy as any).users.add("u1");

    const list = (store.proxy as any).users.items[0].profile.contacts;
    expect(list).toBeDefined();
    expect(typeof list.add).toBe("function");

    list.add({ id: "c1", phone: "+1" });

    // the owner is set to the ROOT entity (u1), not the profile group.
    expect(store.entityRegistry.get("c1")!.owner).toEqual({
      ownerId: "u1",
      ownerListNode: (store.rootConfig as any).users[0].profile.contacts,
    });
    expect([...store.entityRegistry.getChildrenByOwner("u1")!]).toEqual(["c1"]);
  });

  it("getValues materializes the list into the nested path (users[0].profile.contacts)", () => {
    const store = makeGroupListStore();
    store.set({ id: "u1", name: "Alice", profile: { bio: "hi" } });
    (store.proxy as any).users.add("u1");
    (store.proxy as any).users.items[0].profile.contacts.add({ id: "c1", phone: "+1" });

    expect((store.getValues() as any).users).toEqual([
      { id: "u1", name: "Alice", profile: { bio: "hi", contacts: [{ id: "c1", phone: "+1" }] } },
    ]);
  });

  it("entityProxy.values also contains the nested profile.contacts", () => {
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

  it("cascade deletion works for a list inside a group", () => {
    const store = makeGroupListStore();
    store.set({ id: "u1", name: "Alice", profile: { bio: "hi" } });
    (store.proxy as any).users.add("u1");
    (store.proxy as any).users.items[0].profile.contacts.add({ id: "c1", phone: "+1" });

    expect(store.entityRegistry.has("c1")).toBe(true);
    store.delete("u1");
    expect(store.entityRegistry.has("c1")).toBe(false);
  });

  it("owner isolation: different users' profile.contacts are independent", () => {
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

  it("a persist round-trip survives a list in a nested group", async () => {
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
    // The owner is restored → the cascade works after reload.
    expect(store2.entityRegistry.get("c1")!.owner!.ownerId).toBe("u1");
    store2.delete("u1");
    expect(store2.entityRegistry.has("c1")).toBe(false);
  });
});
