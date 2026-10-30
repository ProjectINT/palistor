/**
 * Tests for per-entity nested list resolve.
 *
 * Ported from store/entityListResolve.test.ts, which called
 * `resolveManager.triggerEntityListResolve` directly; here the lazy trigger
 * is a read of `items` on the per-entity list (`users.items[i].contacts`).
 *
 *   - the resolver is called per owner with the owner's correct flat snapshot;
 *   - lists/owner do NOT leak into parentValues;
 *   - a repeated read for the same entity doesn't call the resolver (cache hit);
 *   - two owners → independent memberships;
 *   - tracking-version isolation between owners of one list config.
 *
 * Mutations (add/remove/setItems) and cascade deletion are covered in
 * entityListMutations.test.ts.
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

const ownerOf = (store: any, id: string) =>
  store.entityRegistry.ownerOf?.(id) ?? store.entityRegistry.get(id)?.owner;

const idsOf = (list: any): string[] => list.items.map((i: any) => i.id);

function flush() {
  return new Promise<void>((r) => setTimeout(r, 0));
}

function makeStore(resolver: (...a: any[]) => any) {
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
            resolve: { resolver, onError: vi.fn() },
          }),
        },
      }),
    } as any,
  });
  const listNode = (store.rootConfig as any).users[0].contacts as object;
  const contactsOf = (id: string) => {
    const users = (store.proxy as any).users;
    if (!users.getById(id)) users.add(id);
    return users.getById(id).contacts;
  };
  return { store, listNode, contactsOf };
}

describe("per-entity list resolve (C1)", () => {
  it("the resolver receives the owner's flat snapshot; lists/owner don't leak", async () => {
    const seen: any[] = [];
    const resolver = vi.fn(async (values: any) => {
      seen.push({ ...values });
      return [{ id: "c1", phone: "+1" }];
    });
    const { store, contactsOf } = makeStore(resolver);

    store.set({ id: "u1", name: "Alice" });
    void contactsOf("u1").items;
    await flush();

    expect(resolver).toHaveBeenCalledTimes(1);
    const parentValues = seen[0];
    expect(parentValues.id).toBe("u1");
    expect(parentValues.name).toBe("Alice");
    // Non-enumerable regression: lists/owner must NOT land in the snapshot.
    expect("lists" in parentValues).toBe(false);
    expect("owner" in parentValues).toBe(false);
    expect(Object.keys(parentValues).sort()).toEqual(["id", "name"]);
  });

  it("ingests children with the owner reference and fills the membership", async () => {
    const resolver = vi.fn(async () => [
      { id: "c1", phone: "+1" },
      { id: "c2", phone: "+2" },
    ]);
    const { store, listNode, contactsOf } = makeStore(resolver);

    store.set({ id: "u1", name: "Alice" });
    const list = contactsOf("u1");
    void list.items;
    await flush();

    expect(idsOf(list)).toEqual(["c1", "c2"]);
    expect(list.dirty).toBe(false); // the loaded membership is the baseline

    // the owner reference is set and indexed (not part of the data).
    expect(ownerOf(store, "c1")).toEqual({ ownerId: "u1", ownerListNode: listNode });
    expect(Object.keys(store.entityRegistry.get("c1")!)).not.toContain("owner");
    expect([...store.entityRegistry.getChildrenByOwner("u1")!]).toEqual(["c1", "c2"]);
  });

  it("a repeated read for the same entity doesn't call the resolver (cache hit)", async () => {
    const resolver = vi.fn(async () => [{ id: "c1", phone: "+1" }]);
    const { store, contactsOf } = makeStore(resolver);

    store.set({ id: "u1", name: "Alice" });
    void contactsOf("u1").items;
    await flush();
    void contactsOf("u1").items;
    await flush();

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(contactsOf("u1").resolveStatus).toBe("resolved");
  });

  it("two owners → two independent memberships", async () => {
    const resolver = vi.fn(async (values: any) =>
      values.id === "u1"
        ? [{ id: "c1", phone: "+1" }]
        : [{ id: "c2", phone: "+2" }, { id: "c3", phone: "+3" }],
    );
    const { store, contactsOf } = makeStore(resolver);

    store.set([{ id: "u1", name: "Alice" }, { id: "u2", name: "Bob" }]);
    void contactsOf("u1").items;
    void contactsOf("u2").items;
    await flush();

    expect(idsOf(contactsOf("u1"))).toEqual(["c1"]);
    expect(idsOf(contactsOf("u2"))).toEqual(["c2", "c3"]);
    // Different list nodes on different owners.
    expect(contactsOf("u1")).not.toBe(contactsOf("u2"));
  });

  it("isolation: one owner's resolve doesn't bump the other's list version", async () => {
    const resolver = vi.fn(async () => [{ id: "c1", phone: "+1" }]);
    const { store, contactsOf } = makeStore(resolver);

    store.set([{ id: "u1", name: "Alice" }, { id: "u2", name: "Bob" }]);

    const listA = contactsOf("u1");
    const listB = contactsOf("u2");
    const vA_before = store.getNodeVersion(trackKey(listA));
    const vB_before = store.getNodeVersion(trackKey(listB));

    void listA.items;
    await flush();

    expect(store.getNodeVersion(trackKey(listA))).toBeGreaterThan(vA_before);
    expect(store.getNodeVersion(trackKey(listB))).toBe(vB_before);
  });

  it.todo(
    "an owner deps change → re-resolve (deps-driven re-resolve is planned)",
  );
});
