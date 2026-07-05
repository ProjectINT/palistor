/**
 * Proxy tests for lists and the EntityProjectionProxy.
 *
 * Covers:
 * - ListProxy: items, length, loading, add, remove, getById, setItems, map, Symbol.iterator
 * - EntityProjectionProxy: reading value, formatter, setter, validate, isRequired
 * - Writes through the proxy update the entity leaf
 * - Lists in valuesCache: values.users = [entityObj1, entityObj2, ...]
 */
import { describe, it, expect, vi } from "vitest";
import { Palistor } from "../store";

// ─── Test store factory ───────────────────────────────────────────────────────

const userTemplate = {
  id: { value: "" },
  name: { value: "" },
  role: { value: "" },
};

function makeListStore() {
  return new Palistor({
    config: {
      title: { value: "Users" },
      users: [userTemplate],
    } as any,
  });
}

function makeListStoreWithRules() {
  return new Palistor({
    config: {
      users: [
        {
          id: { value: "" },
          name: {
            value: "",
            formatter: (v: string) => v.trim(),
            validate: (v: string) => (!v ? "Name is required" : undefined),
          },
          age: {
            value: 0,
            isRequired: (vals: any) => Boolean(vals.name),
          },
        },
      ],
    } as any,
  });
}

function makeSingleUserStore() {
  return new Palistor({
    config: {
      users: [
        {
          id: { value: "" },
          name: { value: "" },
          role: { value: "user" },
        },
      ],
    } as any,
  });
}

// ─── ListProxy: basic access ──────────────────────────────────────────────

describe("ListProxy — basic access", () => {
  it("users.length === 0 at initialization", () => {
    const store = makeListStore();
    const form = store.proxy as any;
    expect(form.users.length).toBe(0);
  });

  it("users.items is empty at initialization", () => {
    const store = makeListStore();
    const form = store.proxy as any;
    expect(form.users.items).toEqual([]);
  });

  it("users.loading === false by default", () => {
    const store = makeListStore();
    const form = store.proxy as any;
    expect(form.users.loading).toBe(false);
  });
});

// ─── ListProxy: add ───────────────────────────────────────────────────────────

describe("ListProxy.add(id)", () => {
  it("add(id) adds the entity to the list", () => {
    const store = makeListStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");
    expect(form.users.length).toBe(1);
  });

  it("add(id) — items[0] is an EntityProjectionProxy", () => {
    const store = makeListStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");
    const item = form.users.items[0];
    expect(item).toBeDefined();
    expect(item.name.value).toBe("Alice");
  });

  it("add(id) does not duplicate an entity already in the list", () => {
    const store = makeListStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");
    form.users.add("u1");
    expect(form.users.length).toBe(1);
  });

  it("add(id) for a missing entity — no-op", () => {
    const store = makeListStore();
    const form = store.proxy as any;
    form.users.add("nonexistent");
    expect(form.users.length).toBe(0);
  });

  it("add(id) notifies global subscribers", () => {
    const store = makeListStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    const listener = vi.fn();
    store.subscribeGlobal(listener);
    form.users.add("u1");
    expect(listener).toHaveBeenCalled();
  });
});

describe("ListProxy.add(values)", () => {
  it("add(values) creates the entity and adds it to the list", () => {
    const store = makeListStore();
    const form = store.proxy as any;
    form.users.add({ id: "u2", name: "Bob", role: "user" });
    expect(form.users.length).toBe(1);
    expect(store.entityRegistry.get("u2")).toBeDefined();
  });

  it("add(values) — items[0] shows the added entity", () => {
    const store = makeListStore();
    const form = store.proxy as any;
    form.users.add({ id: "u2", name: "Bob", role: "user" });
    expect(form.users.items[0].name.value).toBe("Bob");
  });
});

// ─── ListProxy: remove ────────────────────────────────────────────────────────

describe("ListProxy.remove(id)", () => {
  it("remove deletes the entity from the list", () => {
    const store = makeListStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    store.set({ id: "u2", name: "Bob", role: "user" });
    const form = store.proxy as any;
    form.users.add("u1");
    form.users.add("u2");
    form.users.remove("u1");
    expect(form.users.length).toBe(1);
    expect(form.users.items[0].id).toBe("u2");
  });

  it("remove — the entity stays in the entityRegistry", () => {
    const store = makeListStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");
    form.users.remove("u1");
    expect(store.entityRegistry.get("u1")).toBeDefined();
  });

  it("remove of a missing id — no-op", () => {
    const store = makeListStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");
    form.users.remove("nonexistent");
    expect(form.users.length).toBe(1);
  });

  it("remove notifies subscribers", () => {
    const store = makeListStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");
    const listener = vi.fn();
    store.subscribeGlobal(listener);
    form.users.remove("u1");
    expect(listener).toHaveBeenCalled();
  });
});

// ─── ListProxy: getById / setItems / map ──────────────────────────────────────

describe("ListProxy.getById(id)", () => {
  it("getById returns the proxy for an entity in the list", () => {
    const store = makeListStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");
    const found = form.users.getById("u1");
    expect(found).toBeDefined();
    expect(found.name.value).toBe("Alice");
  });

  it("getById returns undefined for an entity not in the list", () => {
    const store = makeListStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    expect(form.users.getById("u1")).toBeUndefined();
  });
});

describe("ListProxy.setItems(ids)", () => {
  it("setItems replaces the list", () => {
    const store = makeListStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    store.set({ id: "u2", name: "Bob", role: "user" });
    store.set({ id: "u3", name: "Charlie", role: "user" });
    const form = store.proxy as any;
    form.users.add("u1");
    form.users.add("u2");
    form.users.setItems(["u2", "u3"]);
    expect(form.users.length).toBe(2);
    expect(form.users.items[0].id).toBe("u2");
    expect(form.users.items[1].id).toBe("u3");
  });
});

describe("ListProxy.map(fn)", () => {
  it("map returns the mapped results", () => {
    const store = makeListStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    store.set({ id: "u2", name: "Bob", role: "user" });
    const form = store.proxy as any;
    form.users.add("u1");
    form.users.add("u2");
    const names = form.users.map((item: any) => item.name.value);
    expect(names).toEqual(["Alice", "Bob"]);
  });
});

describe("ListProxy[Symbol.iterator]", () => {
  it("iterates over all items", () => {
    const store = makeListStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    store.set({ id: "u2", name: "Bob", role: "user" });
    const form = store.proxy as any;
    form.users.add("u1");
    form.users.add("u2");
    const names: string[] = [];
    for (const item of form.users) {
      names.push(item.name.value);
    }
    expect(names).toEqual(["Alice", "Bob"]);
  });
});

// ─── EntityProjectionProxy: reading values ──────────────────────────────────

describe("EntityProjectionProxy — reading", () => {
  it("items[0].name.value returns the entity value", () => {
    const store = makeSingleUserStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");
    expect(form.users.items[0].name.value).toBe("Alice");
  });

  it("items[0].id returns the entity id", () => {
    const store = makeSingleUserStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");
    expect(form.users.items[0].id).toBe("u1");
  });

  it("items[0].role.value shows the role value", () => {
    const store = makeSingleUserStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");
    expect(form.users.items[0].role.value).toBe("admin");
  });
});

// ─── EntityProjectionProxy: writing ───────────────────────────────────────────

describe("EntityProjectionProxy — writing", () => {
  it("proxy.name.value = 'X' updates the entity leaf", () => {
    const store = makeSingleUserStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");
    form.users.items[0].name.value = "Alice Cooper";
    // Re-read the value
    expect(form.users.items[0].name.value).toBe("Alice Cooper");
  });

  it("a write notifies global subscribers", () => {
    const store = makeSingleUserStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");
    const listener = vi.fn();
    store.subscribeGlobal(listener);
    form.users.items[0].name.value = "Alice Cooper";
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("writing the same value — no-op (no notification)", () => {
    const store = makeSingleUserStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");
    const listener = vi.fn();
    store.subscribeGlobal(listener);
    form.users.items[0].name.value = "Alice"; // same value
    expect(listener).not.toHaveBeenCalled();
  });
});

// ─── EntityProjectionProxy: formatter ────────────────────────────────────────

describe("EntityProjectionProxy — formatter", () => {
  it("the formatter is applied on write", () => {
    const store = makeListStoreWithRules();
    store.set({ id: "u1", name: "  Alice  ", age: 25 });
    // After store.set, name is stored as-is; formatter applies on write via proxy
    const form = store.proxy as any;
    form.users.add("u1");
    // Write through proxy — formatter trims the value
    form.users.items[0].name.value = "  Bob  ";
    expect(form.users.items[0].name.value).toBe("Bob");
  });
});

// ─── EntityProjectionProxy: validate ─────────────────────────────────────────

describe("EntityProjectionProxy — validate", () => {
  it("isInvalid = true when validate returns an error", () => {
    const store = makeListStoreWithRules();
    store.set({ id: "u1", name: "", age: 25 });
    const form = store.proxy as any;
    form.users.add("u1");
    expect(form.users.items[0].name.isInvalid).toBe(true);
  });

  it("isInvalid = false when validate returns no error", () => {
    const store = makeListStoreWithRules();
    store.set({ id: "u1", name: "Alice", age: 25 });
    const form = store.proxy as any;
    form.users.add("u1");
    expect(form.users.items[0].name.isInvalid).toBe(false);
  });

  it("errorMessage returns the error text", () => {
    const store = makeListStoreWithRules();
    store.set({ id: "u1", name: "", age: 25 });
    const form = store.proxy as any;
    form.users.add("u1");
    expect(form.users.items[0].name.errorMessage).toBe("Name is required");
  });

  it("errorMessage = undefined when there is no error", () => {
    const store = makeListStoreWithRules();
    store.set({ id: "u1", name: "Alice", age: 25 });
    const form = store.proxy as any;
    form.users.add("u1");
    expect(form.users.items[0].name.errorMessage).toBeUndefined();
  });
});

// ─── EntityProjectionProxy: isRequired computed ───────────────────────────────

describe("EntityProjectionProxy — isRequired (computed)", () => {
  it("isRequired is computed from entity values", () => {
    const store = makeListStoreWithRules();
    // age.isRequired: (vals) => Boolean(vals.name)
    store.set({ id: "u1", name: "Alice", age: 25 });
    const form = store.proxy as any;
    form.users.add("u1");
    expect(form.users.items[0].age.isRequired).toBe(true);
  });

  it("isRequired = false when the depended-on field is empty", () => {
    const store = makeListStoreWithRules();
    store.set({ id: "u1", name: "", age: 25 });
    const form = store.proxy as any;
    form.users.add("u1");
    expect(form.users.items[0].age.isRequired).toBe(false);
  });
});

// ─── valuesCache for lists ──────────────────────────────────────────────────

describe("valuesCache — list integration", () => {
  it("values.users is an empty array initially", () => {
    const store = makeListStore();
    expect((store.getValues() as any).users).toEqual([]);
  });

  it("values.users updates after add", () => {
    const store = makeListStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");
    const vals = store.values.values as any;
    expect(vals.users).toHaveLength(1);
    expect(vals.users[0].name).toBe("Alice");
  });

  it("the entity projection obj is a shared reference", () => {
    const store = makeListStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");

    const vals = store.values.values as any;
    const entityObj = vals.users[0];

    // Update via store.set — shared reference should update
    store.set({ id: "u1", name: "Alice Cooper" });
    expect(entityObj.name).toBe("Alice Cooper");
    // valuesCache.values.users[0] is also updated (same reference)
    expect(vals.users[0].name).toBe("Alice Cooper");
  });

  it("values.users updates after remove", () => {
    const store = makeListStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    store.set({ id: "u2", name: "Bob", role: "user" });
    const form = store.proxy as any;
    form.users.add("u1");
    form.users.add("u2");
    form.users.remove("u1");
    const vals = store.values.values as any;
    expect(vals.users).toHaveLength(1);
    expect(vals.users[0].name).toBe("Bob");
  });

  it("isVisible in a computed field uses values.users.length", () => {
    const store = new Palistor({
      config: {
        title: { value: "List" },
        deleteBtn: {
          value: false,
          // Safe optional chaining: users may be undefined during initial registerNodes pass
          isVisible: (values: any) => ((values.users as unknown[]) ?? []).length > 0,
        },
        users: [{ id: { value: "" }, name: { value: "" } }],
      } as any,
    });
    const form = store.proxy as any;

    expect(form.deleteBtn.isVisible).toBe(false);

    store.set({ id: "u1", name: "Alice" });
    form.users.add("u1");

    // After re-read (recompute happens on add notification):
    // isVisible should now reflect that users.length > 0
    expect(form.deleteBtn.isVisible).toBe(true);
  });
});

// ─── Stable proxy references ──────────────────────────────────────────────────

describe("Proxy reference stability", () => {
  it("items[0] across accesses — the same proxy", () => {
    const store = makeSingleUserStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");
    const proxy1 = form.users.items[0];
    const proxy2 = form.users.items[0];
    expect(proxy1).toBe(proxy2);
  });

  it("items[0].name across accesses — the same proxy", () => {
    const store = makeSingleUserStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");
    const nameProxy1 = form.users.items[0].name;
    const nameProxy2 = form.users.items[0].name;
    expect(nameProxy1).toBe(nameProxy2);
  });
});

// ─── EntityProjectionProxy: ownKeys without duplicates ───────────────────────────

describe("EntityProjectionProxy — ownKeys deduplication", () => {
  it("Reflect.ownKeys(entity proxy) does not contain 'id' twice when the template also has id", () => {
    // Regression test: ownKeys returned ["id", "id", ...] when templateKeys
    // already contained "id" (because the template declares id: { value: "" }).
    // Proxying then threw TypeError: trap returned duplicate entries.
    const store = makeSingleUserStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");

    const entityProxy = form.users.items[0];
    const keys = Reflect.ownKeys(entityProxy) as string[];
    const idCount = keys.filter((k) => k === "id").length;
    expect(idCount).toBe(1);
  });

  it("spreading {...entityProxy} does not throw a TypeError on a duplicated template id", () => {
    const store = makeSingleUserStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");

    const entityProxy = form.users.items[0];
    expect(() => ({ ...entityProxy })).not.toThrow();
  });

  it("Object.keys(entityProxy) contains the expected keys", () => {
    const store = makeSingleUserStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");

    const entityProxy = form.users.items[0];
    const keys = Object.keys(entityProxy);
    expect(keys).toContain("id");
    expect(keys).toContain("name");
    expect(keys).toContain("role");
    expect(keys).toContain("loading");
    expect(keys).toContain("submitting");
    expect(keys).toContain("submit");
    expect(keys).toContain("values");
    // Ensure there are no duplicates
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ─── Store.set() + list writes via the EntityProjectionProxy ────────────────────

describe("store.set() + EntityProjectionProxy sync", () => {
  it("store.set updates a value read through the list proxy", () => {
    const store = makeSingleUserStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");

    store.set({ id: "u1", name: "Alice Updated" });
    expect(form.users.items[0].name.value).toBe("Alice Updated");
  });

  it("an EntityProjectionProxy write updates the entityRegistry leaf", () => {
    const store = makeSingleUserStore();
    store.set({ id: "u1", name: "Alice", role: "admin" });
    const form = store.proxy as any;
    form.users.add("u1");

    form.users.items[0].name.value = "Alice Cooper";

    const entity = store.entityRegistry.get("u1")!;
    const nameLeaf = entity.name as { value: unknown };
    expect(nameLeaf.value).toBe("Alice Cooper");
  });
});
