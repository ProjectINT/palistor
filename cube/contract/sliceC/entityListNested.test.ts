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

    // Each per-entity list node is its own tracking identity.
    const emailsC1 = contacts.items[0].emails;
    const emailsC2 = contacts.items[1].emails;

    const vC1before = store.getNodeVersion(trackKey(emailsC1));
    const vC2before = store.getNodeVersion(trackKey(emailsC2));

    contacts.items[0].emails.add({ id: "e1", addr: "a@x.io" });

    expect(store.getNodeVersion(trackKey(emailsC1))).toBeGreaterThan(vC1before);
    expect(store.getNodeVersion(trackKey(emailsC2))).toBe(vC2before);
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
    expect(ownerOf(store, "c1")).toEqual({
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
});
