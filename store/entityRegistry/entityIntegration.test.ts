/**
 * Integration tests for Phase 1B: EntityRegistry integrated with Palistor.
 *
 * Covers:
 * - store.set() → entity created / updated → notification → recompute
 * - store.delete() → entity removed → cleanup → notification
 * - Batch set (one recompute + notify for an array)
 * - Merge behavior (does not delete absent fields)
 * - Nested objects
 * - No-op on no changes / a missing id
 */
import { describe, it, expect, vi } from "vitest";
import { Palistor } from "../store";

function makeStore() {
  return new Palistor({
    config: {
      email: { value: "", label: "Email" },
    },
  });
}

// ─── store.set() ──────────────────────────────────────────────────────────────

describe("store.set()", () => {
  it("creates a new entity and bumps the global version", () => {
    const store = makeStore();
    const vBefore = store.getVersion();
    store.set({ id: "u1", name: "Alice" });
    expect(store.getVersion()).toBeGreaterThan(vBefore);
  });

  it("the entity is registered in the entityRegistry", () => {
    const store = makeStore();
    store.set({ id: "u1", name: "Alice" });
    const entity = store.entityRegistry.get("u1");
    expect(entity).toBeDefined();
    expect((entity!.name as { value: unknown }).value).toBe("Alice");
  });

  it("notifies global subscribers when an entity is created", () => {
    const store = makeStore();
    const listener = vi.fn();
    store.subscribeGlobal(listener);
    store.set({ id: "u1", name: "Alice" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("notifies on an entity update (merge)", () => {
    const store = makeStore();
    store.set({ id: "u1", name: "Alice" });
    const listener = vi.fn();
    store.subscribeGlobal(listener);
    store.set({ id: "u1", name: "Alice Updated" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("updates the entity value on merge", () => {
    const store = makeStore();
    store.set({ id: "u1", name: "Alice" });
    store.set({ id: "u1", name: "Alice Updated" });
    const entity = store.entityRegistry.get("u1");
    expect((entity!.name as { value: unknown }).value).toBe("Alice Updated");
  });

  it("does not notify on a set with the same values (no-op)", () => {
    const store = makeStore();
    store.set({ id: "u1", name: "Alice" });
    const listener = vi.fn();
    store.subscribeGlobal(listener);
    store.set({ id: "u1", name: "Alice" }); // same values
    expect(listener).not.toHaveBeenCalled();
  });

  it("merge: does not delete fields absent from data", () => {
    const store = makeStore();
    store.set({ id: "u1", name: "Alice", email: "alice@example.com" });
    store.set({ id: "u1", name: "Alice Updated" }); // no email
    const entity = store.entityRegistry.get("u1");
    expect((entity!.name as { value: unknown }).value).toBe("Alice Updated");
    expect((entity!.email as { value: unknown }).value).toBe("alice@example.com"); // preserved
  });

  it("merge: adds new fields to an existing entity", () => {
    const store = makeStore();
    store.set({ id: "u1", name: "Alice" });
    store.set({ id: "u1", role: "admin" });
    const entity = store.entityRegistry.get("u1");
    expect((entity!.name as { value: unknown }).value).toBe("Alice"); // preserved
    expect((entity!.role as { value: unknown }).value).toBe("admin"); // added
  });

  it("batch: set with an array of entities", () => {
    const store = makeStore();
    const vBefore = store.getVersion();
    store.set([
      { id: "u1", name: "Alice" },
      { id: "u2", name: "Bob" },
    ]);
    expect(store.getVersion()).toBeGreaterThan(vBefore);
    expect(store.entityRegistry.get("u1")).toBeDefined();
    expect(store.entityRegistry.get("u2")).toBeDefined();
  });

  it("batch: exactly one notify for the array (batched recompute)", () => {
    const store = makeStore();
    const listener = vi.fn();
    store.subscribeGlobal(listener);
    store.set([
      { id: "u1", name: "Alice" },
      { id: "u2", name: "Bob" },
    ]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("auto-generates an id when none is provided", () => {
    const store = makeStore();
    store.set({ name: "Anon" });
    expect(store.entityRegistry.size).toBe(1);
  });

  it("supports nested objects", () => {
    const store = makeStore();
    store.set({
      id: "u1",
      passport: { number: "ABC123", expiry: "2030-01-01" },
    });
    const entity = store.entityRegistry.get("u1");
    const passport = entity!.passport as Record<string, { value: unknown }>;
    expect(passport.number.value).toBe("ABC123");
    expect(passport.expiry.value).toBe("2030-01-01");
  });

  it("notifies the per-node subscriber of the changed leaf node", () => {
    const store = makeStore();
    store.set({ id: "u1", name: "Alice" });
    const nameLeaf = store.entityRegistry.get("u1")!.name as object;
    const listener = vi.fn();
    store.subscribe(nameLeaf, listener);
    store.set({ id: "u1", name: "Alice Updated" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not notify the per-node subscriber when the value is unchanged", () => {
    const store = makeStore();
    store.set({ id: "u1", name: "Alice" });
    const nameLeaf = store.entityRegistry.get("u1")!.name as object;
    const listener = vi.fn();
    store.subscribe(nameLeaf, listener);
    store.set({ id: "u1", name: "Alice" }); // same value
    expect(listener).not.toHaveBeenCalled();
  });
});

// ─── store.delete() ───────────────────────────────────────────────────────────

describe("store.delete()", () => {
  it("removes the entity from the registry", () => {
    const store = makeStore();
    store.set({ id: "u1", name: "Alice" });
    store.delete("u1");
    expect(store.entityRegistry.has("u1")).toBe(false);
  });

  it("bumps the global version on delete", () => {
    const store = makeStore();
    store.set({ id: "u1", name: "Alice" });
    const vBefore = store.getVersion();
    store.delete("u1");
    expect(store.getVersion()).toBeGreaterThan(vBefore);
  });

  it("notifies global subscribers on delete", () => {
    const store = makeStore();
    store.set({ id: "u1", name: "Alice" });
    const listener = vi.fn();
    store.subscribeGlobal(listener);
    store.delete("u1");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("no-op when the entity does not exist — the version is unchanged", () => {
    const store = makeStore();
    const vBefore = store.getVersion();
    store.delete("nonexistent");
    expect(store.getVersion()).toBe(vBefore);
  });

  it("no-op when the entity does not exist — subscribers are not invoked", () => {
    const store = makeStore();
    const listener = vi.fn();
    store.subscribeGlobal(listener);
    store.delete("nonexistent");
    expect(listener).not.toHaveBeenCalled();
  });

  it("clears the bindings on delete", () => {
    const store = makeStore();
    const template = {};
    store.set({ id: "u1", name: "Alice" });
    store.entityRegistry.bind("u1", template);
    store.delete("u1");
    expect(store.entityRegistry.has("u1")).toBe(false);
    expect(store.entityRegistry.getBindings("u1")).toBeUndefined();
  });

  it("clears the resolvedCache on delete", () => {
    const store = makeStore();
    const template = {};
    store.set({ id: "u1", name: "Alice" });
    store.entityRegistry.markResolved("u1", template);
    store.delete("u1");
    expect(store.entityRegistry.isResolved("u1", template)).toBe(false);
  });

  it("deleted leaf nodes are removed from leafNodes (memory-leak guard)", () => {
    const store = makeStore();
    const leafCountBefore = store.nodes.computeNodes.length;
    store.set({ id: "u1", name: "Alice", email: "alice@example.com" });
    expect(store.nodes.computeNodes.length).toBeGreaterThan(leafCountBefore);
    store.delete("u1");
    expect(store.nodes.computeNodes.length).toBe(leafCountBefore);
  });
});

// ─── store.set() — updating an entity in a list ────────────────────────────────

describe("store.set() — updating a list entity by id", () => {
  function makeListStore() {
    return new Palistor({
      config: {
        users: [
          { id: { value: "" }, name: { value: "" }, role: { value: "" } },
        ],
      } as any,
    });
  }

  it("store.set updates an entity added to the list — the value is visible via the list proxy", () => {
    const store = makeListStore();
    store.set({ id: "u1", name: "Alice", role: "viewer" });
    (store.proxy as any).users.add("u1");

    store.set({ id: "u1", name: "Alice Updated" });

    expect((store.proxy as any).users.items[0].name.value).toBe("Alice Updated");
    // role was untouched — it must remain
    expect((store.proxy as any).users.items[0].role.value).toBe("viewer");
  });

  it("store.set updates a list entity — getValues() returns current data", () => {
    const store = makeListStore();
    store.set({ id: "u1", name: "Alice", role: "viewer" });
    (store.proxy as any).users.add("u1");

    store.set({ id: "u1", name: "Alice Updated", role: "admin" });

    const values = (store.proxy as any).users.getValues() as Array<Record<string, unknown>>;
    expect(values).toHaveLength(1);
    expect(values[0].name).toBe("Alice Updated");
    expect(values[0].role).toBe("admin");
  });

  it("several entities in the list — store.set updates only the targeted one", () => {
    const store = makeListStore();
    store.set({ id: "u1", name: "Alice", role: "viewer" });
    store.set({ id: "u2", name: "Bob", role: "viewer" });
    (store.proxy as any).users.add("u1");
    (store.proxy as any).users.add("u2");

    store.set({ id: "u1", name: "Alice Updated" });

    expect((store.proxy as any).users.items[0].name.value).toBe("Alice Updated");
    expect((store.proxy as any).users.items[1].name.value).toBe("Bob"); // unchanged
  });

  it("store.set updates the entity — the targeted entity's leaf subscriber is invoked", () => {
    const store = makeListStore();
    store.set({ id: "u1", name: "Alice", role: "viewer" });
    store.set({ id: "u2", name: "Bob", role: "viewer" });
    (store.proxy as any).users.add("u1");
    (store.proxy as any).users.add("u2");

    const u1NameLeaf = store.entityRegistry.get("u1")!.name as object;
    const u2NameLeaf = store.entityRegistry.get("u2")!.name as object;
    const listenerU1 = vi.fn();
    const listenerU2 = vi.fn();
    store.subscribe(u1NameLeaf, listenerU1);
    store.subscribe(u2NameLeaf, listenerU2);

    store.set({ id: "u1", name: "Alice Updated" });

    // only u1 was updated — only its subscriber must fire
    expect(listenerU1).toHaveBeenCalledTimes(1);
    expect(listenerU2).not.toHaveBeenCalled();
  });

  it("store.set on a list entity — merge does not delete fields absent from the patch", () => {
    const store = makeListStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    (store.proxy as any).users.add("u1");

    // update only name, role is not passed
    store.set({ id: "u1", name: "Alice Renamed" });

    expect((store.proxy as any).users.items[0].name.value).toBe("Alice Renamed");
    expect((store.proxy as any).users.items[0].role.value).toBe("admin"); // preserved
  });
});
