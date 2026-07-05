/**
 * Tests for defineList.
 *
 * Covers:
 *  1. Result structure (unit — without a Palistor store)
 *  2. Store integration: the async resolver loads the list
 *  3. Dedup — repeated access doesn't trigger an extra resolver
 *  4. The loading flag while the resolver runs
 *  5. deps — re-runs on dependency changes
 *  6. onError — invoked on resolver failure
 *  7. defineList without a resolver — a manually managed list
 *  8. Nested defineList inside a group
 *  9. Multiple defineLists in one config
 * 10. Typing — compiles without errors
 */
import { describe, it, expect, vi } from "vitest";
import { defineList } from "./defineList";
import { Palistor } from "./store";
import type { TypedListNode, TemplateConfig, ListResolver } from "./store/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function flushPromises() {
  return new Promise<void>((r) => setTimeout(r, 0));
}

function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// ─── 1. Result structure ──────────────────────────────────────────────────────

describe("defineList — result structure", () => {
  it("without a resolver → an array of length 1, element[0] = template", () => {
    const template = { id: { value: "" }, name: { value: "" } };
    const node = defineList({ template });

    expect(Array.isArray(node)).toBe(true);
    expect((node as unknown as any[]).length).toBe(1);
    expect((node as unknown as any[])[0]).toBe(template);
  });

  it("with a resolver → an array of length 2, element[1].resolve holds the resolver", () => {
    const template = { id: { value: "" }, name: { value: "" } };
    const resolver = vi.fn(async () => []);
    const node = defineList<{ id: string; name: string }>({ template, resolve: { resolver } });

    const arr = node as unknown as any[];
    expect(arr.length).toBe(2);
    expect(arr[0]).toBe(template);
    expect(arr[1]).toBeDefined();
    expect(arr[1].resolve).toBeDefined();
    expect(arr[1].resolve.resolver).toBe(resolver);
  });

  it("deps is passed into the resolve config", () => {
    const template = { id: { value: "" } };
    const resolver = vi.fn(async () => []);
    const node = defineList<{ id: string }>({
      template,
      resolve: { resolver, deps: ["filter", "page"] },
    });

    const resolveConfig = (node as unknown as any[])[1].resolve;
    expect(resolveConfig.deps).toEqual(["filter", "page"]);
  });

  it("onError is passed into the resolve config", () => {
    const template = { id: { value: "" } };
    const resolver = vi.fn(async () => []);
    const onError = vi.fn();
    const node = defineList<{ id: string }>({ template, resolve: { resolver, onError } });

    const resolveConfig = (node as unknown as any[])[1].resolve;
    expect(resolveConfig.onError).toBe(onError);
  });

  it("without resolve — element[1] is absent", () => {
    const template = { id: { value: "" } };
    const node = defineList({ template });

    expect((node as unknown as any[]).length).toBe(1);
    expect((node as unknown as any[])[1]).toBeUndefined();
  });
});

// ─── 2. Integration: the resolver loads the list ──────────────────────────────

describe("defineList + Palistor — the async resolver loads the list", () => {
  it("the resolver runs after the first items access (lazy)", async () => {
    const resolver = vi.fn(async () => [
      { id: "u1", name: "Alice" },
      { id: "u2", name: "Bob" },
    ]);

    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, onError: vi.fn() },
        }),
      } as any,
    });

    // Before access the resolver was not called (lazy by default)
    expect(resolver).not.toHaveBeenCalled();

    void (store.proxy as any).users.items;

    await flushPromises();

    expect(resolver).toHaveBeenCalledTimes(1);
    expect((store.proxy as any).users.length).toBe(2);
  });

  it("the resolver loads data → items hold the right values", async () => {
    const resolver = vi.fn(async () => [
      { id: "u1", name: "Alice" },
      { id: "u2", name: "Bob" },
    ]);

    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    const users = (store.proxy as any).users;
    expect(users.items[0].name.value).toBe("Alice");
    expect(users.items[1].name.value).toBe("Bob");
  });

  it("the resolver loads data → entities are registered in the registry", async () => {
    const resolver = vi.fn(async () => [
      { id: "u1", name: "Alice" },
      { id: "u2", name: "Bob" },
    ]);

    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    expect(store.entityRegistry.get("u1")).toBeDefined();
    expect(store.entityRegistry.get("u2")).toBeDefined();
  });

  it("a resolver returning an empty array → the list is empty", async () => {
    const resolver = vi.fn(async (): Promise<{ id: string; name: string }[]> => []);

    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    expect((store.proxy as any).users.length).toBe(0);
    expect((store.proxy as any).users.dirty).toBe(false);
  });

  it("the resolver receives the current form values", async () => {
    const resolver = vi.fn(async (_values: any): Promise<{ id: string; name: string }[]> => []);

    const store = new Palistor({
      config: {
        filter: { value: "active" },
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    const calledWith = resolver.mock.calls[0][0];
    expect(calledWith).toMatchObject({ filter: "active" });
  });
});

// ─── 3. Dedup — repeated access doesn't trigger an extra resolver ─────────────

describe("defineList — resolver deduplication", () => {
  it("repeated accesses while pending → the resolver runs exactly once", async () => {
    let resolvePromise!: (v: any) => void;
    const resolver = vi.fn(() => new Promise<any[]>((r) => { resolvePromise = r; }));

    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    void (store.proxy as any).users.items;
    void (store.proxy as any).users.items;

    // flush microtask so resolver is actually called and resolvePromise is assigned
    await Promise.resolve();

    resolvePromise([{ id: "u1", name: "Alice" }]);
    await flushPromises();

    expect(resolver).toHaveBeenCalledTimes(1);
    expect((store.proxy as any).users.length).toBe(1);
  });
});

// ─── 4. The loading flag ──────────────────────────────────────────────────────

describe("defineList — loading flag", () => {
  it("loading = false before the first access", () => {
    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver: vi.fn(async (): Promise<{ id: string; name: string }[]> => []), onError: vi.fn() },
        }),
      } as any,
    });

    expect((store.proxy as any).users.loading).toBe(false);
  });

  it("loading = true while the resolver runs", async () => {
    let resolvePromise!: (v: any) => void;
    const resolver = vi.fn(() => new Promise<any[]>((r) => { resolvePromise = r; }));

    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await Promise.resolve(); // flush microtask

    expect((store.proxy as any).users.loading).toBe(true);

    resolvePromise([{ id: "u1", name: "Alice" }]);
    await flushPromises();

    expect((store.proxy as any).users.loading).toBe(false);
  });

  it("loading = false for a defineList without a resolver", () => {
    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
        }),
      } as any,
    });

    expect((store.proxy as any).users.loading).toBe(false);
  });

  it("loading = false after a resolver error", async () => {
    const resolver = vi.fn(async () => { throw new Error("fail"); });

    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    expect((store.proxy as any).users.loading).toBe(false);
  });

  it("notifies global subscribers when loading changes", async () => {
    let resolvePromise!: (v: any) => void;
    const resolver = vi.fn(() => new Promise<any[]>((r) => { resolvePromise = r; }));

    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, onError: vi.fn() },
        }),
      } as any,
    });

    const listener = vi.fn();
    store.subscribeGlobal(listener);
    listener.mockClear();

    void (store.proxy as any).users.items;
    await Promise.resolve();

    // loading = true → notify
    expect(listener).toHaveBeenCalled();
    listener.mockClear();

    resolvePromise([{ id: "u1", name: "Alice" }]);
    await flushPromises();

    // loading = false + data → notify
    expect(listener).toHaveBeenCalled();
  });
});

// ─── 5. deps — re-runs on dependency changes ─────────────────────────────────

describe("defineList — deps retrigger", () => {
  it("the resolver re-runs when a deps field changes", async () => {
    const resolver = vi.fn(async (values: any) => {
      if (values.filter === "active") return [{ id: "u1", name: "Alice" }];
      return [{ id: "u2", name: "Bob" }];
    });

    const store = new Palistor({
      config: {
        filter: { value: "active" },
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, onError: vi.fn(), deps: ["filter"] },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    expect(resolver).toHaveBeenCalledTimes(1);
    expect((store.proxy as any).users.length).toBe(1);
    expect((store.proxy as any).users.items[0].name.value).toBe("Alice");

    // Change the dependency
    (store.proxy as any).filter.value = "inactive";
    await flushPromises();

    expect(resolver).toHaveBeenCalledTimes(2);
    expect((store.proxy as any).users.length).toBe(1);
    expect((store.proxy as any).users.items[0].name.value).toBe("Bob");
  });

  it("the resolver does NOT re-run when a non-deps field changes", async () => {
    const resolver = vi.fn(async () => [{ id: "u1", name: "Alice" }]);

    const store = new Palistor({
      config: {
        filter: { value: "active" },
        unrelated: { value: "x" },
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, onError: vi.fn(), deps: ["filter"] },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    expect(resolver).toHaveBeenCalledTimes(1);

    (store.proxy as any).unrelated.value = "y";
    await flushPromises();

    // NOT re-triggered — unrelated not in deps
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("with deps=[] the resolver never re-runs on changes", async () => {
    const resolver = vi.fn(async () => [{ id: "u1", name: "Alice" }]);

    const store = new Palistor({
      config: {
        filter: { value: "active" },
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, onError: vi.fn(), deps: [] },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    (store.proxy as any).filter.value = "inactive";
    await flushPromises();

    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("the resolver re-runs on each of several deps independently", async () => {
    let callCount = 0;
    const resolver = vi.fn(async () => {
      callCount++;
      return [{ id: `u${callCount}`, name: `User${callCount}` }];
    });

    const store = new Palistor({
      config: {
        page: { value: 1 },
        sort: { value: "asc" },
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, onError: vi.fn(), deps: ["page", "sort"] },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();
    expect(callCount).toBe(1);

    (store.proxy as any).page.value = 2;
    await flushPromises();
    expect(callCount).toBe(2);

    (store.proxy as any).sort.value = "desc";
    await flushPromises();
    expect(callCount).toBe(3);
  });
});

// ─── 6. onError — resolver error handling ─────────────────────────────────────

describe("defineList — onError", () => {
  it("onError is called when the resolver throws", async () => {
    const error = new Error("network failure");
    const onError = vi.fn();
    const resolver = vi.fn(async () => { throw error; });

    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, onError },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ notify: expect.any(Function) }),
    );
  });

  it("onError receives notify from store.setNotifier", async () => {
    const notifyFn = vi.fn();
    const onError = vi.fn((_err: unknown, ctx: { notify: (msg: string) => void }) => {
      ctx.notify("Loading failed");
    });

    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: {
            resolver: vi.fn(async () => { throw new Error("fail"); }),
            onError,
          },
        }),
      } as any,
    });

    store.setNotifier(notifyFn);

    void (store.proxy as any).users.items;
    await flushPromises();

    expect(notifyFn).toHaveBeenCalledWith("Loading failed");
  });

  it("the list stays empty after a resolver error", async () => {
    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: {
            resolver: vi.fn(async () => { throw new Error("fail"); }),
            onError: vi.fn(),
          },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    expect((store.proxy as any).users.length).toBe(0);
    expect((store.proxy as any).users.loading).toBe(false);
  });

  it("items can be added manually after an error", async () => {
    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: {
            resolver: vi.fn(async () => { throw new Error("fail"); }),
            onError: vi.fn(),
          },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    store.set({ id: "u1", name: "Alice" });
    (store.proxy as any).users.add("u1");

    expect((store.proxy as any).users.length).toBe(1);
    expect((store.proxy as any).users.items[0].name.value).toBe("Alice");
  });
});

// ─── 7. defineList without a resolver — manual management ────────────────────

describe("defineList without a resolver", () => {
  it("the list is empty at initialization", () => {
    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
        }),
      } as any,
    });

    expect((store.proxy as any).users.length).toBe(0);
    expect((store.proxy as any).users.loading).toBe(false);
    expect((store.proxy as any).users.dirty).toBe(false);
  });

  it("add + values from store.set", () => {
    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
        }),
      } as any,
    });

    store.set({ id: "u1", name: "Alice" });
    (store.proxy as any).users.add("u1");

    expect((store.proxy as any).users.length).toBe(1);
    expect((store.proxy as any).users.items[0].name.value).toBe("Alice");
    expect((store.proxy as any).users.dirty).toBe(true);
  });

  it("add with an object creates the entity and adds it to the list", () => {
    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
        }),
      } as any,
    });

    (store.proxy as any).users.add({ id: "u1", name: "Alice" });

    expect((store.proxy as any).users.length).toBe(1);
    expect((store.proxy as any).users.items[0].name.value).toBe("Alice");
  });

  it("remove deletes the item from the list", () => {
    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
        }),
      } as any,
    });

    store.set({ id: "u1", name: "Alice" });
    store.set({ id: "u2", name: "Bob" });
    (store.proxy as any).users.add("u1");
    (store.proxy as any).users.add("u2");
    expect((store.proxy as any).users.length).toBe(2);

    (store.proxy as any).users.remove("u1");
    expect((store.proxy as any).users.length).toBe(1);
    expect((store.proxy as any).users.items[0].name.value).toBe("Bob");
  });

  it("getById returns the right item", () => {
    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
        }),
      } as any,
    });

    store.set({ id: "u1", name: "Alice" });
    store.set({ id: "u2", name: "Bob" });
    (store.proxy as any).users.add("u1");
    (store.proxy as any).users.add("u2");

    const item = (store.proxy as any).users.getById("u2");
    expect(item).toBeDefined();
    expect(item.name.value).toBe("Bob");
  });

  it("getById returns undefined for a missing id", () => {
    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
        }),
      } as any,
    });

    const item = (store.proxy as any).users.getById("nonexistent");
    expect(item).toBeUndefined();
  });

  it("setItems replaces the whole list", () => {
    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
        }),
      } as any,
    });

    store.set({ id: "u1", name: "Alice" });
    store.set({ id: "u2", name: "Bob" });
    store.set({ id: "u3", name: "Carol" });
    (store.proxy as any).users.add("u1");
    (store.proxy as any).users.add("u2");

    (store.proxy as any).users.setItems(["u3"]);
    expect((store.proxy as any).users.length).toBe(1);
    expect((store.proxy as any).users.items[0].name.value).toBe("Carol");
  });
});

// ─── 8. Nested defineList inside a group ─────────────────────────────────────

describe("defineList — nested inside a group", () => {
  it("a defineList inside a group node works correctly", async () => {
    const resolver = vi.fn(async () => [
      { id: "p1", title: "Item A" },
    ]);

    const store = new Palistor({
      config: {
        section: {
          label: { value: "Section" },
          products: defineList({
            template: { id: { value: "" }, title: { value: "" } },
            resolve: { resolver, onError: vi.fn() },
          }),
        },
      } as any,
    });

    void (store.proxy as any).section.products.items;
    await flushPromises();

    expect(resolver).toHaveBeenCalledTimes(1);
    expect((store.proxy as any).section.products.length).toBe(1);
    expect((store.proxy as any).section.products.items[0].title.value).toBe("Item A");
  });
});

// ─── 9. Multiple defineLists in one config ───────────────────────────────────

describe("defineList — several lists in a config", () => {
  it("two defineLists with resolvers work independently", async () => {
    const usersResolver = vi.fn(async () => [{ id: "u1", name: "Alice" }]);
    const rolesResolver = vi.fn(async () => [{ id: "r1", code: "admin" }]);

    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver: usersResolver, onError: vi.fn() },
        }),
        roles: defineList({
          template: { id: { value: "" }, code: { value: "" } },
          resolve: { resolver: rolesResolver, onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    void (store.proxy as any).roles.items;
    await flushPromises();

    expect(usersResolver).toHaveBeenCalledTimes(1);
    expect(rolesResolver).toHaveBeenCalledTimes(1);

    expect((store.proxy as any).users.length).toBe(1);
    expect((store.proxy as any).roles.length).toBe(1);
    expect((store.proxy as any).users.items[0].name.value).toBe("Alice");
    expect((store.proxy as any).roles.items[0].code.value).toBe("admin");
  });

  it("the two lists' resolvers do not affect each other", async () => {
    const errResolver = vi.fn(async () => { throw new Error("fail"); });
    const okResolver = vi.fn(async () => [{ id: "u1", name: "Alice" }]);

    const store = new Palistor({
      config: {
        broken: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver: errResolver, onError: vi.fn() },
        }),
        working: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver: okResolver, onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).broken.items;
    void (store.proxy as any).working.items;
    await flushPromises();

    expect((store.proxy as any).broken.length).toBe(0);
    expect((store.proxy as any).working.length).toBe(1);
    expect((store.proxy as any).working.items[0].name.value).toBe("Alice");
  });
});

// ─── 10. Typing (compile-time) ─────────────────────────────────────────────────

describe("defineList — typing compiles", () => {
  it("TypedListNode is accepted in a Palistor config", () => {
    interface User {
      id: string;
      name: string;
      email: string;
    }

    // A fully typed defineList
    const usersNode = defineList<User>({
      template: {
        id: { value: "" },
        name: { value: "" },
        email: { value: "" },
      },
      resolve: {
        resolver: async (): Promise<User[]> => [],
        deps: ["filter"],
        onError: (_err, { notify }) => { notify("error"); },
      },
    });

    // The TypedListNode<User> type
    const check: TypedListNode<User> = usersNode;
    expect(check).toBeDefined();
  });

  it("defineList without resolve is accepted as a TypedListNode", () => {
    interface Product {
      id: string;
      title: string;
    }

    const node = defineList<Product>({
      template: { id: { value: "" }, title: { value: "" } },
    });

    const typed: TypedListNode<Product> = node;
    const arr = typed as unknown as any[];
    expect(arr[0]).toBeDefined();
    expect(arr[1]).toBeUndefined();
  });

  it("ListResolver<TEntity> has the right signature", () => {
    type Resolver = ListResolver<{ id: string; name: string }>;

    const resolver: Resolver = async () => [{ id: "u1", name: "Alice" }];
    expect(typeof resolver).toBe("function");
  });

  it("TemplateConfig<TEntity> types the template correctly", () => {
    interface Item {
      id: string;
      count: number;
    }

    const template: TemplateConfig<Item> = {
      id: { value: "" },
      count: { value: 0 },
    };

    const node = defineList<Item>({ template });
    expect((node as unknown as any[])[0]).toBe(template);
  });
});
