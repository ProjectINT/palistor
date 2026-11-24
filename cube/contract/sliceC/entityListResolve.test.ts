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
import { onCube } from "../impl";

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

// A full reset and a nested list that has loaded. Both implementations put the membership back to
// what the resolver loaded and request nothing by themselves. They differ on the next read:
// store clears the list's resolve state, so the read fetches the rows again; Cube (Stage 5а, on
// purpose) keeps a result it has, as both already do for a root list.
describe("per-entity list resolve and store.reset()", () => {
  const rows = () => [{ id: "c1", phone: "+1" }, { id: "c2", phone: "+2" }];

  it("a loaded list returns to the loaded rows; the next read fetches again on store, keeps the result on Cube", async () => {
    const resolver = vi.fn(async () => rows());
    const { store, contactsOf } = makeStore(resolver);
    store.set({ id: "u1", name: "Alice" });
    void contactsOf("u1").items;
    await flush();
    expect(idsOf(contactsOf("u1"))).toEqual(["c1", "c2"]);

    contactsOf("u1").add({ id: "c3", phone: "+3" });
    contactsOf("u1").remove("c1");
    expect(contactsOf("u1").dirty).toBe(true);

    store.reset();
    await flush();
    expect(resolver).toHaveBeenCalledTimes(1); // the reset itself requests nothing

    expect(idsOf(contactsOf("u1"))).toEqual(["c1", "c2"]); // a read
    expect(contactsOf("u1").dirty).toBe(false);
    await flush();
    expect(resolver).toHaveBeenCalledTimes(onCube ? 1 : 2);
    expect(contactsOf("u1").resolveStatus).toBe("resolved");
    expect(contactsOf("u1").loading).toBe(false);
    expect(idsOf(contactsOf("u1"))).toEqual(["c1", "c2"]);
  });

  it("a list whose run is in flight starts over after the reset, on both", async () => {
    let release!: (rows: unknown[]) => void;
    const resolver = vi.fn(() => new Promise<unknown[]>((r) => { release = r; }));
    const { store, contactsOf } = makeStore(resolver);
    store.set({ id: "u1", name: "Alice" });
    void contactsOf("u1").items;
    await flush();
    expect(contactsOf("u1").resolveStatus).toBe("pending");

    store.reset();
    await flush();
    expect(resolver).toHaveBeenCalledTimes(1);

    void contactsOf("u1").items; // the next read runs the resolver again
    await flush();
    expect(resolver).toHaveBeenCalledTimes(2);
    release(rows());
    await flush();
    expect(idsOf(contactsOf("u1"))).toEqual(["c1", "c2"]);
    expect(contactsOf("u1").resolveStatus).toBe("resolved");
  });

  it("a list whose run failed starts over after the reset, on both", async () => {
    let fail = true;
    const resolver = vi.fn(async () => { if (fail) throw new Error("boom"); return rows(); });
    const { store, contactsOf } = makeStore(resolver);
    store.set({ id: "u1", name: "Alice" });
    void contactsOf("u1").items;
    await flush();
    expect(contactsOf("u1").resolveStatus).toBe("error");

    fail = false;
    store.reset();
    await flush();
    expect(resolver).toHaveBeenCalledTimes(1);

    void contactsOf("u1").items;
    await flush();
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(idsOf(contactsOf("u1"))).toEqual(["c1", "c2"]);
  });
});

// What fills a nested list. Not the list above it: a nested array inside a row the root resolver
// returns is not the nested list's membership (both implementations). The nested list gets its
// rows from its own resolver, from add / setItems — and, on Cube, from `initialData`
// (cube/ssr/initialDataLists.test.tsx).
describe("a root list's resolver and the lists nested in its rows", () => {
  it("rows returned with a nested array leave the nested list empty until its own resolver or add() fills it", async () => {
    const nested = vi.fn(async () => [{ id: "c9", phone: "+9" }]);
    const store = new Palistor({
      config: {
        users: defineList({
          template: {
            id: { value: "" },
            name: { value: "" },
            contacts: defineList({ template: { id: { value: "" }, phone: { value: "" } }, resolve: { resolver: nested, onError: vi.fn() } }),
            notes: defineList({ template: { id: { value: "" }, text: { value: "" } } }),
          },
          resolve: {
            resolver: async () => [{
              id: "u1",
              name: "Alice",
              contacts: [{ id: "c1", phone: "+1" }, { id: "c2", phone: "+2" }],
              notes: [{ id: "n1", text: "hello" }],
            }],
            onError: vi.fn(),
          },
        }),
      } as any,
    });
    const users = (store.proxy as any).users;
    void users.items;
    await flush();
    const u1 = users.getById("u1");
    expect(u1.name.value).toBe("Alice");

    // No resolver of its own: the list stays empty.
    expect(idsOf(u1.notes)).toEqual([]);
    u1.notes.add({ id: "n1", text: "hello" });
    expect(idsOf(u1.notes)).toEqual(["n1"]);

    // With a resolver: the read starts it, and its rows are the membership, not the root resolver's.
    expect(idsOf(u1.contacts)).toEqual([]);
    await flush();
    expect(nested).toHaveBeenCalledTimes(1);
    expect(idsOf(u1.contacts)).toEqual(["c9"]);
  });
});
