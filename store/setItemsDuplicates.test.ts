/**
 * Regression: setItems() must not accept duplicate ids — add() guards
 * membership with an .includes() check, so duplicates violate the list
 * invariant (React keys by entity id collide, membership dirty-diff
 * double-counts, remove(id) drops only the first occurrence).
 */
import { describe, it, expect } from "vitest";
import { Palistor } from "./store";
import { defineList } from "./defineList";
import { buildListProxy } from "./buildProxy/buildListProxy";

const tpl = { id: { value: "" }, name: { value: "" } };

describe("setItems duplicate ids", () => {
  it("root list: deduplicates, preserving first-occurrence order", () => {
    const store = new Palistor({ config: { users: [tpl] } as any });
    store.set({ id: "u1", name: "A" } as any);
    store.set({ id: "u2", name: "B" } as any);
    (store.proxy as any).users.setItems(["u1", "u2", "u1", "u2", "u1"]);
    const ls = (store as any).nodes.allListStates[0];
    expect(ls.itemIds).toEqual(["u1", "u2"]);
    expect((store.proxy as any).users.length).toBe(2);
  });

  it("per-entity list: deduplicates too", () => {
    const store = new Palistor({
      config: {
        editUser: {
          id: { value: "" },
          contacts: defineList({ template: { id: { value: "" }, phone: { value: "" } } }),
        },
      } as any,
    });
    const listNode = (store.rootConfig as any).editUser.contacts as object;
    store.set({ id: "owner1" } as any);
    store.set({ id: "c1", phone: "1" } as any);
    const owner = (store as any).entityRegistry.get("owner1");
    const ls = (store as any).entityRegistry.getOrCreateEntityListState(owner, listNode);
    const list = buildListProxy(ls, store as any) as any;
    list.setItems(["c1", "c1"]);
    expect(ls.itemIds).toEqual(["c1"]);
  });
});
