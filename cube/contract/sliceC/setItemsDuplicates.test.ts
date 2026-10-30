/**
 * Regression: setItems() must not accept duplicate ids — add() guards
 * membership with an .includes() check, so duplicates violate the list
 * invariant (React keys by entity id collide, membership dirty-diff
 * double-counts, remove(id) drops only the first occurrence).
 *
 * The per-entity case went through buildListProxy over an EntityListState in
 * store/setItemsDuplicates.test.ts; here it is the `contacts` list of a user
 * in a root list.
 */
import { describe, it, expect } from "vitest";
import { Palistor, defineList } from "@impl";

const tpl = { id: { value: "" }, name: { value: "" } };
const idsOf = (list: any): string[] => list.items.map((i: any) => i.id);

describe("setItems duplicate ids", () => {
  it("root list: deduplicates, preserving first-occurrence order", () => {
    const store = new Palistor({ config: { users: [tpl] } as any });
    store.set({ id: "u1", name: "A" } as any);
    store.set({ id: "u2", name: "B" } as any);
    (store.proxy as any).users.setItems(["u1", "u2", "u1", "u2", "u1"]);
    expect(idsOf((store.proxy as any).users)).toEqual(["u1", "u2"]);
    expect((store.proxy as any).users.length).toBe(2);
  });

  it("per-entity list: deduplicates too", () => {
    const store = new Palistor({
      config: {
        users: defineList({
          template: {
            id: { value: "" },
            contacts: defineList({ template: { id: { value: "" }, phone: { value: "" } } }) as any,
          },
        }),
      } as any,
    });
    store.set({ id: "owner1" } as any);
    store.set({ id: "c1", phone: "1" } as any);
    (store.proxy as any).users.add("owner1");
    const list = (store.proxy as any).users.items[0].contacts;
    list.setItems(["c1", "c1"]);
    expect(idsOf(list)).toEqual(["c1"]);
    expect(list.length).toBe(1);
  });
});
