/**
 * Regression: store.delete(id) must keep list membership and the projection
 * map consistent.
 *
 * delete() removed the entity from EntityRegistry but (unlike rekey(), which
 * maintains itemIds in every registered list) left the id in ListState.itemIds
 * and the projection object in entityProjectionObjs. Downstream,
 * syncListValuesCache silently filters ids without a projection, so `items` /
 * `getValues()` disagreed with `length` / `itemIds` / `dirty`.
 */
import { describe, it, expect } from "vitest";
import { Palistor, defineList } from "@impl";

const tpl = { id: { value: "" }, name: { value: "" } };

describe("store.delete() list consistency", () => {
  it("removes the id from a root list's itemIds (length/dirty stay truthful)", () => {
    const store = new Palistor({ config: { users: [tpl] } as any });
    (store.proxy as any).users.add({ id: "u1", name: "Alice" });
    expect((store.proxy as any).users.length).toBe(1);

    store.delete("u1");

    expect((store.proxy as any).users.length).toBe(0);
    expect((store.proxy as any).users.dirty).toBe(false); // added then deleted: back to the initial (empty) membership
    expect((store.proxy as any).users.items).toEqual([]);
  });

  it("removes the id from the owner's per-entity list when a child is deleted directly", () => {
    const store = new Palistor({
      config: {
        users: defineList({
          template: {
            id: { value: "" },
            name: { value: "" },
            contacts: defineList({ template: { id: { value: "" }, phone: { value: "" } } }),
          },
        }),
      } as any,
    });

    store.set({ id: "owner1", name: "Boss" } as any);
    (store.proxy as any).users.add("owner1");
    const list = (store.proxy as any).users.items[0].contacts;
    list.add({ id: "c1", phone: "111" });
    expect(list.items.map((c: any) => c.id)).toEqual(["c1"]);

    store.delete("c1"); // delete the child directly, not via list.remove
    expect(list.items.map((c: any) => c.id)).toEqual([]);
    expect(list.length).toBe(0);
  });

  it("leaves nothing behind in the registry (no unbounded growth)", () => {
    const store = new Palistor({ config: { users: [tpl] } as any });
    for (let i = 0; i < 50; i++) {
      store.set({ id: `u${i}`, name: `U${i}` } as any);
      (store.proxy as any).users.add(`u${i}`);
      void (store.proxy as any).users.items[0].name.value;
      store.delete(`u${i}`);
    }
    expect(store.entityRegistry.size).toBe(0);
    expect((store.proxy as any).users.length).toBe(0);
  });
});
