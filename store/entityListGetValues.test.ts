/**
 * Tests for per-entity nested lists in getValues.
 *
 * Verifies that the per-entity list membership materializes:
 *   - in `store.getValues()` (via the owner's projectionObj);
 *   - in `entityProxy.values` (the owner's deep snapshot);
 *   - in `list.getValues()` (the entity-list proxy).
 *
 * Scenario — a root `users` list, each user has its own `contacts`.
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
  return store;
}

describe("per-entity list getValues (C3)", () => {
  it("store.getValues() includes the nested contacts (manual add)", () => {
    const store = makeStore();
    store.set([{ id: "u1", name: "Alice" }, { id: "u2", name: "Bob" }]);
    (store.proxy as any).users.add("u1");
    (store.proxy as any).users.add("u2");

    (store.proxy as any).users.items[0].contacts.add({ id: "c1", phone: "+1" });
    (store.proxy as any).users.items[0].contacts.add({ id: "c2", phone: "+2" });
    (store.proxy as any).users.items[1].contacts.add({ id: "c3", phone: "+3" });

    const values = store.getValues() as any;
    expect(values.users).toEqual([
      { id: "u1", name: "Alice", contacts: [{ id: "c1", phone: "+1" }, { id: "c2", phone: "+2" }] },
      { id: "u2", name: "Bob", contacts: [{ id: "c3", phone: "+3" }] },
    ]);
  });

  it("getValues is isolated: each owner sees its own contacts", () => {
    const store = makeStore();
    store.set([{ id: "u1", name: "Alice" }, { id: "u2", name: "Bob" }]);
    (store.proxy as any).users.add("u1");
    (store.proxy as any).users.add("u2");
    (store.proxy as any).users.items[0].contacts.add({ id: "c1", phone: "+1" });

    const values = store.getValues() as any;
    // u1 got contacts, u2 never touched its list → no contacts key.
    expect(values.users[0].contacts).toEqual([{ id: "c1", phone: "+1" }]);
    expect("contacts" in values.users[1]).toBe(false);
  });

  it("entityProxy.values contains the nested contacts", () => {
    const store = makeStore();
    store.set({ id: "u1", name: "Alice" });
    (store.proxy as any).users.add("u1");
    (store.proxy as any).users.items[0].contacts.add({ id: "c1", phone: "+1" });

    const u1 = (store.proxy as any).users.items[0];
    expect(u1.values).toEqual({
      id: "u1",
      name: "Alice",
      contacts: [{ id: "c1", phone: "+1" }],
    });
  });

  it("list.getValues() returns the child entities' values", () => {
    const store = makeStore();
    store.set({ id: "u1", name: "Alice" });
    (store.proxy as any).users.add("u1");
    const list = (store.proxy as any).users.items[0].contacts;
    list.add({ id: "c1", phone: "+1" });
    list.add({ id: "c2", phone: "+2" });

    expect(list.getValues()).toEqual([
      { id: "c1", phone: "+1" },
      { id: "c2", phone: "+2" },
    ]);
  });

  it("getValues includes contacts loaded by the resolver", async () => {
    const resolver = vi.fn(async (v: any) =>
      v.id === "u1" ? [{ id: "c1", phone: "+1" }] : [],
    );
    const store = makeStore(resolver);
    store.set({ id: "u1", name: "Alice" });
    (store.proxy as any).users.add("u1");

    // Lazily trigger the resolve by reading items.
    void (store.proxy as any).users.items[0].contacts.items;
    await flush();

    const values = store.getValues() as any;
    expect(values.users[0].contacts).toEqual([{ id: "c1", phone: "+1" }]);
  });

  it("3-level nesting: users → contacts → emails", () => {
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
                emails: defineList({
                  template: { id: { value: "" }, addr: { value: "" } },
                }),
              },
            }),
          },
        }),
      } as any,
    });

    store.set({ id: "u1", name: "Alice" });
    (store.proxy as any).users.add("u1");
    const contacts = (store.proxy as any).users.items[0].contacts;
    contacts.add({ id: "c1", phone: "+1" });
    contacts.items[0].emails.add({ id: "e1", addr: "a@x.io" });

    const values = store.getValues() as any;
    expect(values.users[0].contacts[0].emails).toEqual([{ id: "e1", addr: "a@x.io" }]);
  });
});
