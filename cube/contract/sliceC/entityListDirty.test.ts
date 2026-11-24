/**
 * Dirty tests for per-entity nested lists.
 *
 * Verifies:
 *   - list.dirty by membership (itemIds vs initialItemIds);
 *   - the owner's dirty (entityProxy.dirty) aggregates list composition;
 *   - add/remove affect dirty; going back to initial → dirty=false;
 *   - reset() restores the initial membership and clears dirty.
 */

import { describe, it, expect, vi } from "vitest";
import { Palistor, defineList } from "@impl";
import { onCube } from "../impl";
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
  it("an empty untouched list is not dirty", () => {
    const store = makeStore();
    const list = (store.proxy as any).users.items[0].contacts;
    expect(list.dirty).toBe(false);
  });

  it("add makes the list dirty, and the owner too", () => {
    const store = makeStore();
    const u1 = (store.proxy as any).users.items[0];
    const list = u1.contacts;

    expect(u1.dirty).toBe(false);
    list.add({ id: "c1", phone: "+1" });

    expect(list.dirty).toBe(true);
    expect(u1.dirty).toBe(true);
  });

  it("restoring the membership to initial clears dirty", () => {
    const store = makeStore();
    const list = (store.proxy as any).users.items[0].contacts;

    list.add({ id: "c1", phone: "+1" });
    expect(list.dirty).toBe(true);

    list.remove("c1");
    // itemIds is empty again == initial → not dirty.
    expect(list.dirty).toBe(false);
    expect((store.proxy as any).users.items[0].dirty).toBe(false);
  });

  it("after the resolve the list is not dirty (initialItemIds is synced)", async () => {
    const resolver = vi.fn(async () => [{ id: "c1", phone: "+1" }]);
    const store = makeStore(resolver);
    const list = (store.proxy as any).users.items[0].contacts;

    void list.items; // lazily trigger the resolve
    await flush();

    expect(list.dirty).toBe(false);

    list.add({ id: "c2", phone: "+2" });
    expect(list.dirty).toBe(true);
  });

  it("reset() restores the initial membership and clears dirty", async () => {
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
    // the owner's getValues rolled back too.
    expect((store.getValues() as any).users[0].contacts).toEqual([{ id: "c1", phone: "+1" }]);
  });
});

// An edit inside a nested list. Both implementations: the nested list and the row that owns it
// are dirty. store stops there. Cube (Stage 5а, on purpose) carries it up: the list the owner is
// a row of and the form are dirty too, so "unsaved changes" on the form covers nested lists.
describe("per-entity list dirty reaches the parent list and the form", () => {
  it("a root list loaded by its resolver: nested add and remove, then back to the loaded rows", async () => {
    const store = new Palistor({
      config: {
        title: { value: "" },
        users: defineList({
          template: {
            id: { value: "" },
            name: { value: "" },
            contacts: defineList({
              template: { id: { value: "" }, phone: { value: "" } },
              resolve: { resolver: async () => [{ id: "c1", phone: "+1" }], onError: vi.fn() },
            }),
          },
          resolve: { resolver: async () => [{ id: "u1", name: "Alice" }, { id: "u2", name: "Bob" }], onError: vi.fn() },
        }),
      } as any,
    });
    const form = store.proxy as any;
    void form.users.items;
    await flush();
    const contacts = form.users.items[0].contacts;
    void contacts.items;
    await flush();
    expect([contacts.dirty, form.users.items[0].dirty, form.users.dirty, form.dirty]).toEqual([false, false, false, false]);

    contacts.add({ id: "c2", phone: "+2" });
    expect([contacts.dirty, form.users.items[0].dirty]).toEqual([true, true]);
    expect([form.users.dirty, form.dirty]).toEqual([onCube, onCube]);
    expect(form.users.items[1].dirty).toBe(false); // the other row is not touched

    contacts.remove("c2");
    expect([contacts.dirty, form.users.items[0].dirty, form.users.dirty, form.dirty]).toEqual([false, false, false, false]);

    contacts.remove("c1");
    expect([form.users.dirty, form.dirty]).toEqual([onCube, onCube]);
  });

  it("store.reset() clears it along the whole chain", async () => {
    const store = new Palistor({
      config: {
        users: defineList({
          template: {
            id: { value: "" },
            contacts: defineList({ template: { id: { value: "" }, phone: { value: "" } } }),
          },
          resolve: { resolver: async () => [{ id: "u1" }], onError: vi.fn() },
        }),
      } as any,
    });
    const form = store.proxy as any;
    void form.users.items;
    await flush();
    form.users.items[0].contacts.add({ id: "c1", phone: "+1" });
    expect(form.users.items[0].contacts.dirty).toBe(true);

    store.reset();
    const u1 = form.users.items[0];
    expect([u1.contacts.dirty, u1.dirty, form.users.dirty, form.dirty]).toEqual([false, false, false, false]);
    expect(u1.contacts.length).toBe(0);
  });

  it("a successful submit that resets (afterSubmit) clears it along the whole chain; a submit alone does not", async () => {
    const onSubmit = vi.fn(async () => "saved");
    const makeForm = (afterSubmit?: (result: unknown, actions: { reset(): void }) => void) => {
      const store = new Palistor({
        config: {
          title: { value: "" },
          users: defineList({
            template: {
              id: { value: "" },
              contacts: defineList({ template: { id: { value: "" }, phone: { value: "" } } }),
            },
            resolve: { resolver: async () => [{ id: "u1" }], onError: vi.fn() },
          }),
          onSubmit,
          ...(afterSubmit ? { afterSubmit } : {}),
        } as any,
      });
      return { store, form: store.proxy as any };
    };
    const chain = (form: any) => {
      const u1 = form.users.items[0];
      return [u1.contacts.dirty, u1.dirty, form.users.dirty, form.dirty];
    };

    const plain = makeForm();
    void plain.form.users.items;
    await flush();
    plain.form.users.items[0].contacts.add({ id: "c1", phone: "+1" });
    expect((await plain.store.submit()).success).toBe(true);
    expect(chain(plain.form)).toEqual([true, true, onCube, onCube]); // a submit moves no baseline, as before

    const resetting = makeForm((_result, { reset }) => reset());
    void resetting.form.users.items;
    await flush();
    resetting.form.users.items[0].contacts.add({ id: "c1", phone: "+1" });
    expect((await resetting.store.submit()).success).toBe(true);
    expect(chain(resetting.form)).toEqual([false, false, false, false]);
  });
});
