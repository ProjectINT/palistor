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
import { Palistor } from "../store";
import { defineList } from "../defineList";
import { buildListProxy } from "../buildProxy/buildListProxy";

const tpl = { id: { value: "" }, name: { value: "" } };

describe("store.delete() list consistency", () => {
  it("removes the id from a root list's itemIds (length/dirty stay truthful)", () => {
    const store = new Palistor({ config: { users: [tpl] } as any });
    (store.proxy as any).users.add({ id: "u1", name: "Alice" });
    expect((store.proxy as any).users.length).toBe(1);

    store.delete("u1");

    const ls = (store as any).nodes.allListStates[0];
    expect(ls.itemIds).toEqual([]);
    expect((store.proxy as any).users.length).toBe(0);
    expect((store.proxy as any).users.items).toEqual([]);
  });

  it("removes the id from the owner's per-entity list when a child is deleted directly", () => {
    const store = new Palistor({
      config: {
        editUser: {
          id: { value: "" },
          name: { value: "" },
          contacts: defineList({ template: { id: { value: "" }, phone: { value: "" } } }),
        },
      } as any,
    });
    const listNode = (store.rootConfig as any).editUser.contacts as object;

    store.set({ id: "owner1", name: "Boss" } as any);
    const owner = (store as any).entityRegistry.get("owner1");
    const ls = (store as any).entityRegistry.getOrCreateEntityListState(owner, listNode);
    const list = buildListProxy(ls, store as any) as any;
    list.add({ id: "c1", phone: "111" });
    expect(ls.itemIds).toEqual(["c1"]);

    store.delete("c1"); // delete the child directly, not via list.remove
    expect(ls.itemIds).toEqual([]);
  });

  it("cleans the entityProjectionObjs entry (no unbounded growth)", () => {
    const store = new Palistor({ config: { users: [tpl] } as any });
    for (let i = 0; i < 50; i++) {
      store.set({ id: `u${i}`, name: `U${i}` } as any);
      store.delete(`u${i}`);
    }
    expect((store as any).entityProjectionObjs.size).toBe(0);
  });
});
