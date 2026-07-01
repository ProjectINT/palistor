/**
 * Regression: `list.add(values)` must return the created entity proxy (TItem),
 * matching the `ListProxyNode.add(values): TItem` type. `list.add(id)` returns void.
 */
import { describe, it, expect } from "vitest";
import { Palistor } from "./store";

function makeStore() {
  return new Palistor({
    config: {
      users: [{ id: { value: "" }, name: { value: "" } }],
    },
  });
}

describe("list.add() return value", () => {
  it("add(values) returns the created entity proxy", () => {
    const store = makeStore();
    const list = (store.proxy as any).users;

    const created = list.add({ id: "u1", name: "Alice" });

    expect(created).toBeDefined();
    expect(created.id).toBe("u1");
    expect(created.name.value).toBe("Alice");
    // stable reference: same as getById
    expect(created).toBe(list.getById("u1"));
  });

  it("add(values) without id returns proxy with a generated id", () => {
    const store = makeStore();
    const list = (store.proxy as any).users;

    const created = list.add({ name: "Bob" });

    expect(created).toBeDefined();
    expect(typeof created.id).toBe("string");
    expect(created.id.length).toBeGreaterThan(0);
    expect(created.name.value).toBe("Bob");
  });

  it("add(id) returns undefined (void overload)", () => {
    const store = makeStore();
    store.set({ id: "u9", name: "Existing" });
    const list = (store.proxy as any).users;

    const result = list.add("u9");

    expect(result).toBeUndefined();
    expect(list.getById("u9")).toBeDefined();
  });
});
