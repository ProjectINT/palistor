/**
 * Tests for the list resolver + React tracking + list dirty state.
 *
 * Covers:
 * 1 - List resolver: the resolver loads a list → entities are created → the proxy works.
 * 2 - rekey updates itemIds in all lists.
 * 3 - List tracking: version++ on add/remove → re-render (via getNodeVersion).
 *     An entity leaf change → only the leaf node's version changes (not the whole list).
 * 4 - Dirty: add/remove → dirty. After resolve → clean.
 * 5 - Full end-to-end scenario.
 */
import { describe, it, expect, vi } from "vitest";
import { Palistor } from "../store";
import { defineList } from "../defineList";
import { LIST_STATE } from "../constants";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function flushPromises() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

const userTemplate = {
  id: { value: "" },
  name: { value: "" },
  role: { value: "user" },
};

// ─── List resolver ───────────────────────────────────────────────────────────

describe("List resolver", () => {
  it("the resolver loads the list → entities are created in the registry", async () => {
    const resolver = vi.fn(async () => [
      { id: "u1", name: "Alice", role: "admin" },
      { id: "u2", name: "Bob", role: "user" },
    ]);

    const store = new Palistor({
      config: {
        users: [
          userTemplate,
          { resolve: { resolver, onError: vi.fn() } },
        ],
      } as any,
    });

    // Trigger lazy resolve by accessing items
    const form = store.proxy as any;
    void form.users.items; // triggers lazy resolve

    await flushPromises();

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(store.entityRegistry.get("u1")).toBeDefined();
    expect(store.entityRegistry.get("u2")).toBeDefined();
  });

  it("the resolver loads the list → listState.itemIds is updated", async () => {
    const resolver = vi.fn(async () => [
      { id: "u1", name: "Alice", role: "admin" },
      { id: "u2", name: "Bob", role: "user" },
    ]);

    const store = new Palistor({
      config: {
        users: [
          userTemplate,
          { resolve: { resolver, onError: vi.fn() } },
        ],
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    expect((store.proxy as any).users.length).toBe(2);
  });

  it("root list loading comes from the resolve state (single source)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const resolver = vi.fn(async () => {
      await gate;
      return [{ id: "u1", name: "Alice", role: "admin" }];
    });

    const store = new Palistor({
      config: {
        users: [userTemplate, { resolve: { resolver, onError: vi.fn() } }],
      } as any,
    });

    const listProxy = (store.proxy as any).users;
    const listState = listProxy[LIST_STATE] as object;
    const rm = store.resolveManager as any;

    // Before access: resolve is idle → loading false. loading === (status === "pending").
    expect(rm.getListResolveState(listState).status).toBe("idle");
    expect(listProxy.loading).toBe(false);
    expect(listProxy.loading).toBe(rm.getListResolveState(listState).status === "pending");

    // Accessing items → lazy resolve (deferred queueMicrotask) → the resolver hangs on the gate.
    void listProxy.items;
    await flushPromises();

    // Pending: loading === true, and it is EXACTLY the resolve-state status (not nodeState).
    expect(rm.getListResolveState(listState).status).toBe("pending");
    expect(listProxy.loading).toBe(true);
    expect(listProxy.loading).toBe(rm.getListResolveState(listState).status === "pending");

    release();
    await flushPromises();

    // Resolved: loading false, same source.
    expect(rm.getListResolveState(listState).status).toBe("resolved");
    expect(listProxy.loading).toBe(false);
    expect(listProxy.loading).toBe(rm.getListResolveState(listState).status === "pending");
  });

  it("per-entity list loading comes from the resolve state (single source)", async () => {
    // Mirror of the root test above: the per-entity branch (ownerEntity !== null)
    // must read loading from the SAME getListResolveState(listState), and lazy
    // access to .items must go through the single entry point
    // triggerListResolve(listState) → triggerEntityListResolve.
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const resolver = vi.fn(async () => {
      await gate;
      return [{ id: "c1", phone: "+1" }];
    });

    const store = new Palistor({
      config: {
        users: defineList({
          template: {
            id: { value: "" },
            name: { value: "" },
            // A nested per-entity list inside an entity template. The `any`
            // cast is a known TemplateConfig typing gap on nested lists (same
            // pattern in react/entity-list-nested.test.tsx); behavior is correct.
            contacts: defineList({
              template: { id: { value: "" }, phone: { value: "" } },
              resolve: { resolver, onError: vi.fn() },
            }) as any,
          },
        }),
      } as any,
    });

    store.set({ id: "u1", name: "Alice" });
    (store.proxy as any).users.add("u1");

    // The per-entity list proxy of owner u1 (ownerEntity !== null).
    const listProxy = (store.proxy as any).users.items[0].contacts;
    const listState = listProxy[LIST_STATE] as { ownerEntity: unknown };
    const rm = store.resolveManager as any;
    expect(listState.ownerEntity).not.toBeNull(); // specifically the per-entity branch

    // Before access: the resolve state doesn't exist yet → loading false.
    // loading === (getListResolveState(...)?.status === "pending").
    expect(rm.getListResolveState(listState)?.status).toBeUndefined();
    expect(listProxy.loading).toBe(false);
    expect(listProxy.loading).toBe(rm.getListResolveState(listState)?.status === "pending");

    // Accessing items → lazy resolve (deferred) → the resolver hangs on the gate.
    void listProxy.items;
    await flushPromises();

    // Pending: loading === true, exactly the resolve-state status (not nodeState/entityStates directly).
    expect(rm.getListResolveState(listState).status).toBe("pending");
    expect(listProxy.loading).toBe(true);
    expect(listProxy.loading).toBe(rm.getListResolveState(listState).status === "pending");

    release();
    await flushPromises();

    // Resolved: loading false, same source; the list membership landed.
    expect(rm.getListResolveState(listState).status).toBe("resolved");
    expect(listProxy.loading).toBe(false);
    expect(listProxy.loading).toBe(rm.getListResolveState(listState).status === "pending");
    expect(listProxy.length).toBe(1);
  });

  it("the resolver loads the list → the proxy items show the entities", async () => {
    const resolver = vi.fn(async () => [
      { id: "u1", name: "Alice", role: "admin" },
    ]);

    const store = new Palistor({
      config: {
        users: [
          userTemplate,
          { resolve: { resolver, onError: vi.fn() } },
        ],
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    const users = (store.proxy as any).users;
    expect(users.items[0].name.value).toBe("Alice");
    expect(users.items[0].role.value).toBe("admin");
  });

  it("loading: true while the resolver runs", async () => {
    let resolvePromise!: (v: any) => void;
    const resolver = vi.fn(
      () => new Promise<any[]>((r) => { resolvePromise = r; }),
    );

    const store = new Palistor({
      config: {
        users: [
          userTemplate,
          { resolve: { resolver, onError: vi.fn() } },
        ],
      } as any,
    });

    void (store.proxy as any).users.items;

    // Flush microtask — triggerResolve is deferred to avoid setState-in-render
    await Promise.resolve();

    expect((store.proxy as any).users.loading).toBe(true);

    resolvePromise([{ id: "u1", name: "Alice", role: "admin" }]);
    await flushPromises();

    expect((store.proxy as any).users.loading).toBe(false);
  });

  it("loading: false when no resolver is configured", () => {
    const store = new Palistor({
      config: { users: [userTemplate] } as any,
    });
    expect((store.proxy as any).users.loading).toBe(false);
  });

  it("the resolver notifies global subscribers after a successful resolve", async () => {
    const resolver = vi.fn(async () => [{ id: "u1", name: "Alice", role: "admin" }]);

    const store = new Palistor({
      config: {
        users: [
          userTemplate,
          { resolve: { resolver, onError: vi.fn() } },
        ],
      } as any,
    });

    const listener = vi.fn();
    store.subscribeGlobal(listener);
    listener.mockClear();

    void (store.proxy as any).users.items;
    await flushPromises();

    expect(listener).toHaveBeenCalled();
  });

  it("an eager resolver (lazy: false) launches right at init", async () => {
    const resolver = vi.fn(async () => [{ id: "u1", name: "Alice", role: "admin" }]);

    new Palistor({
      config: {
        users: [
          userTemplate,
          { resolve: { resolver, onError: vi.fn(), options: { lazy: false } } },
        ],
      } as any,
    });

    // The resolver is called immediately (eager)
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("onError is called when the resolver throws", async () => {
    const onError = vi.fn();
    const resolver = vi.fn(async () => { throw new Error("network error"); });

    const store = new Palistor({
      config: {
        users: [
          userTemplate,
          { resolve: { resolver, onError } },
        ],
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    expect(onError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ notify: expect.any(Function) }));
    expect((store.proxy as any).users.loading).toBe(false);
  });

  it("the resolver updates initialItemIds → dirty = false after resolve", async () => {
    const resolver = vi.fn(async () => [
      { id: "u1", name: "Alice", role: "admin" },
    ]);

    const store = new Palistor({
      config: {
        users: [
          userTemplate,
          { resolve: { resolver, onError: vi.fn() } },
        ],
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    // After resolve → clean (initialItemIds == itemIds)
    expect((store.proxy as any).users.dirty).toBe(false);
  });

  it("the resolver creates no duplicates on repeated access", async () => {
    let callCount = 0;
    const resolver = vi.fn(async () => {
      callCount++;
      return [{ id: "u1", name: "Alice", role: "admin" }];
    });

    const store = new Palistor({
      config: {
        users: [
          userTemplate,
          { resolve: { resolver, onError: vi.fn() } },
        ],
      } as any,
    });

    // Multiple accesses while pending → deduplication
    void (store.proxy as any).users.items;
    void (store.proxy as any).users.items;
    void (store.proxy as any).users.items;

    await flushPromises();
    expect(callCount).toBe(1);
  });

  it("the resolver receives the store as the second argument", async () => {
    let capturedStore: unknown;
    const resolver = vi.fn(async (_values: unknown, store: unknown) => {
      capturedStore = store;
      return [{ id: "u1", name: "Alice", role: "admin" }];
    });

    const store = new Palistor({
      config: {
        users: [
          userTemplate,
          { resolve: { resolver, onError: vi.fn() } },
        ],
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    // storeProxy wraps the store to track context dependencies, so
    // capturedStore !== store by reference, but delegates all other properties
    expect((capturedStore as any).entityRegistry).toBe(store.entityRegistry);
  });
});

// ─── rekey — itemIds updates ─────────────────────────────────────────────────

describe("rekey() — itemIds updates", () => {
  it("rekey updates the entity id", () => {
    const store = new Palistor({
      config: { users: [userTemplate] } as any,
    });

    store.set({ id: "_tmp_abc", name: "Alice", role: "user" });
    (store.proxy as any).users.add("_tmp_abc");

    store.rekey("_tmp_abc", "u1");

    expect(store.entityRegistry.get("u1")).toBeDefined();
    expect(store.entityRegistry.get("_tmp_abc")).toBeUndefined();
  });

  it("rekey updates itemIds in ListState", () => {
    const store = new Palistor({
      config: { users: [userTemplate] } as any,
    });

    store.set({ id: "_tmp_abc", name: "Alice", role: "user" });
    (store.proxy as any).users.add("_tmp_abc");
    expect((store.proxy as any).users.length).toBe(1);

    store.rekey("_tmp_abc", "u1");

    expect((store.proxy as any).users.length).toBe(1);
    expect((store.proxy as any).users.items[0].name.value).toBe("Alice");
  });

  it("rekey updates itemIds across multiple lists", () => {
    const store = new Palistor({
      config: {
        users: [userTemplate],
        admins: [userTemplate],
      } as any,
    });

    store.set({ id: "_tmp1", name: "Alice", role: "admin" });
    (store.proxy as any).users.add("_tmp1");
    (store.proxy as any).admins.add("_tmp1");

    store.rekey("_tmp1", "realId1");

    expect((store.proxy as any).users.items[0].name.value).toBe("Alice");
    expect((store.proxy as any).admins.items[0].name.value).toBe("Alice");
  });

  it("rekey notifies subscribers", () => {
    const store = new Palistor({
      config: { users: [userTemplate] } as any,
    });

    store.set({ id: "_tmp_x", name: "Bob", role: "user" });

    const listener = vi.fn();
    store.subscribeGlobal(listener);
    listener.mockClear();

    store.rekey("_tmp_x", "u_real");
    expect(listener).toHaveBeenCalled();
  });

  it("rekey is a no-op for a missing id", () => {
    const store = new Palistor({
      config: { users: [userTemplate] } as any,
    });

    // Should not throw
    expect(() => store.rekey("nonexistent", "new_id")).not.toThrow();
  });
});

// ─── List tracking for React ─────────────────────────────────────────────────

describe("List tracking — versions", () => {
  it("the list version is bumped on add", () => {
    const store = new Palistor({
      config: { users: [userTemplate] } as any,
    });

    store.set({ id: "u1", name: "Alice", role: "admin" });

    // Access list proxy to trigger proxy creation
    const listNode = (store.proxy as any).users[Symbol.for("CONFIG_NODE") as any];
    // Get the list config node via buildListProxy internal mechanism
    // We track via getNodeVersion on the list node
    const config = store.rootConfig as any;
    const listConfigNode = config.users; // the array

    const vBefore = store.getNodeVersion(listConfigNode);
    (store.proxy as any).users.add("u1");
    const vAfter = store.getNodeVersion(listConfigNode);

    expect(vAfter).toBeGreaterThan(vBefore);
  });

  it("the root list is tracked via the LIST_STATE object (its version grows on add/remove)", () => {
    const store = new Palistor({
      config: { users: [userTemplate] } as any,
    });

    store.set({ id: "u1", name: "Alice", role: "admin" });

    // The root list proxy exposes the LIST_STATE brand → the ListState object.
    const listProxy = (store.proxy as any).users;
    const listState = listProxy[LIST_STATE] as object;
    expect(listState).toBeDefined();
    expect((listState as any).ownerEntity).toBeNull();

    // Tracking is keyed by this object: its version grows on mutations.
    const vBefore = store.getNodeVersion(listState);
    listProxy.add("u1");
    const vAfterAdd = store.getNodeVersion(listState);
    expect(vAfterAdd).toBeGreaterThan(vBefore);

    listProxy.remove("u1");
    const vAfterRemove = store.getNodeVersion(listState);
    expect(vAfterRemove).toBeGreaterThan(vAfterAdd);
  });

  it("the list version is bumped on remove", () => {
    const store = new Palistor({
      config: { users: [userTemplate] } as any,
    });

    store.set({ id: "u1", name: "Alice", role: "admin" });
    (store.proxy as any).users.add("u1");

    const config = store.rootConfig as any;
    const listConfigNode = config.users;

    const vBefore = store.getNodeVersion(listConfigNode);
    (store.proxy as any).users.remove("u1");
    const vAfter = store.getNodeVersion(listConfigNode);

    expect(vAfter).toBeGreaterThan(vBefore);
  });

  it("the entity leaf version is bumped on a change through store.set()", () => {
    const store = new Palistor({
      config: { users: [userTemplate] } as any,
    });

    store.set({ id: "u1", name: "Alice", role: "admin" });
    (store.proxy as any).users.add("u1");

    // Get entity leaf node
    const entityNode = store.entityRegistry.get("u1")!;
    const nameLeaf = (entityNode as any).name as object;

    const leafBefore = store.getNodeVersion(nameLeaf);
    store.set({ id: "u1", name: "Alice Updated" });
    const leafAfter = store.getNodeVersion(nameLeaf);

    expect(leafAfter).toBeGreaterThan(leafBefore);
  });

  it("add does not change the entity leaf version", () => {
    const store = new Palistor({
      config: { users: [userTemplate] } as any,
    });

    store.set({ id: "u1", name: "Alice", role: "admin" });

    const entityNode = store.entityRegistry.get("u1")!;
    const nameLeaf = (entityNode as any).name as object;

    // Ensure leaf is registered in nodeVersions
    void store.getNodeVersion(nameLeaf);
    const leafBefore = store.getNodeVersion(nameLeaf);

    (store.proxy as any).users.add("u1");
    const leafAfter = store.getNodeVersion(nameLeaf);

    // Leaf version should NOT change — only the list changed
    expect(leafAfter).toBe(leafBefore);
  });

  it("resolve bumps the listNode version", async () => {
    const resolver = vi.fn(async () => [
      { id: "u1", name: "Alice", role: "admin" },
    ]);

    const store = new Palistor({
      config: {
        users: [
          userTemplate,
          { resolve: { resolver, onError: vi.fn() } },
        ],
      } as any,
    });

    const config = store.rootConfig as any;
    const listNode = config.users;

    const vBefore = store.getNodeVersion(listNode);
    void (store.proxy as any).users.items;
    await flushPromises();
    const vAfter = store.getNodeVersion(listNode);

    expect(vAfter).toBeGreaterThan(vBefore);
  });
});

// ─── Dirty for lists ─────────────────────────────────────────────────────────

describe("Dirty for lists", () => {
  it("dirty = false at initialization", () => {
    const store = new Palistor({
      config: { users: [userTemplate] } as any,
    });
    expect((store.proxy as any).users.dirty).toBe(false);
  });

  it("dirty = true after add", () => {
    const store = new Palistor({
      config: { users: [userTemplate] } as any,
    });
    store.set({ id: "u1", name: "Alice", role: "admin" });
    (store.proxy as any).users.add("u1");
    expect((store.proxy as any).users.dirty).toBe(true);
  });

  it("dirty = true after remove", () => {
    const store = new Palistor({
      config: { users: [userTemplate] } as any,
    });
    store.set({ id: "u1", name: "Alice", role: "admin" });
    // Manually set initialItemIds to simulate a prior resolve
    const listNode = (store.rootConfig as any).users;
    const listState = store.nodes.listStates.get(listNode)!;
    listState.itemIds = ["u1"];
    listState.initialItemIds = ["u1"];

    (store.proxy as any).users.remove("u1");
    expect((store.proxy as any).users.dirty).toBe(true);
  });

  it("dirty contributes to root form.dirty", () => {
    const store = new Palistor({
      config: {
        title: { value: "Users" },
        users: [userTemplate],
      } as any,
    });

    store.set({ id: "u1", name: "Alice", role: "admin" });
    // Prime the initial state
    const listNode = (store.rootConfig as any).users;
    const listState = store.nodes.listStates.get(listNode)!;
    listState.itemIds = ["u1"];
    listState.initialItemIds = ["u1"];

    // Remove — makes list dirty
    (store.proxy as any).users.remove("u1");

    // Root form should now be dirty
    expect((store.proxy as any).dirty).toBe(true);
  });

  it("dirty = false after the resolver loads the list (initialItemIds syncs)", async () => {
    const resolver = vi.fn(async () => [
      { id: "u1", name: "Alice", role: "admin" },
      { id: "u2", name: "Bob", role: "user" },
    ]);

    const store = new Palistor({
      config: {
        users: [
          userTemplate,
          { resolve: { resolver, onError: vi.fn() } },
        ],
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    // After resolve, initialItemIds = itemIds → not dirty
    expect((store.proxy as any).users.dirty).toBe(false);
  });

  it("dirty = true after add on a resolved list", async () => {
    const resolver = vi.fn(async () => [
      { id: "u1", name: "Alice", role: "admin" },
    ]);

    const store = new Palistor({
      config: {
        users: [
          userTemplate,
          { resolve: { resolver, onError: vi.fn() } },
        ],
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    // Add a new entity → dirty
    store.set({ id: "u2", name: "Bob", role: "user" });
    (store.proxy as any).users.add("u2");
    expect((store.proxy as any).users.dirty).toBe(true);
  });
});

// ─── End-to-end scenario ─────────────────────────────────────────────────────

describe("End-to-end scenario", () => {
  it("full cycle: resolver → proxy → edit → notify", async () => {
    const resolver = vi.fn(async () => [
      { id: "u1", name: "Alice", role: "admin" },
      { id: "u2", name: "Bob", role: "user" },
    ]);

    const store = new Palistor({
      config: {
        users: [
          userTemplate,
          { resolve: { resolver, onError: vi.fn() } },
        ],
      } as any,
    });

    const listener = vi.fn();
    store.subscribeGlobal(listener);

    // Trigger lazy resolve
    void (store.proxy as any).users.items;
    await flushPromises();

    // The list is loaded
    expect((store.proxy as any).users.length).toBe(2);
    expect((store.proxy as any).users.items[0].name.value).toBe("Alice");

    // Edit the name through the proxy
    listener.mockClear();
    (store.proxy as any).users.items[0].name.value = "Alice Cooper";
    expect((store.proxy as any).users.items[0].name.value).toBe("Alice Cooper");
    expect(listener).toHaveBeenCalled();

    // Membership-wise the list is clean (nothing added/removed)
    expect((store.proxy as any).users.dirty).toBe(false);

    // Add a new entity → dirty
    store.set({ id: "u3", name: "Carol", role: "user" });
    (store.proxy as any).users.add("u3");
    expect((store.proxy as any).users.length).toBe(3);
    expect((store.proxy as any).users.dirty).toBe(true);

    // Remove the entity → still dirty?
    (store.proxy as any).users.remove("u3");
    expect((store.proxy as any).users.length).toBe(2);
    // We removed u3 which wasn't in initialItemIds; now itemIds=[u1,u2]
    // which equals initialItemIds=[u1,u2] — so we're back to clean!
    expect((store.proxy as any).users.dirty).toBe(false);
  });

  it("rekey workflow: tmp → real id", async () => {
    const store = new Palistor({
      config: { users: [userTemplate] } as any,
    });

    // Add entity with tmp id
    (store.proxy as any).users.add({ id: "_tmp_abc", name: "New User", role: "user" });
    expect((store.proxy as any).users.length).toBe(1);

    // Simulate server response: rekey to real id
    store.rekey("_tmp_abc", "server_id_123");

    expect((store.proxy as any).users.length).toBe(1);
    expect(store.entityRegistry.get("server_id_123")).toBeDefined();
    expect(store.entityRegistry.get("_tmp_abc")).toBeUndefined();
    expect((store.proxy as any).users.items[0].name.value).toBe("New User");
  });
});

// ─── Dep retrigger for list resolvers ────────────────────────────────────────

describe("list resolver dep retrigger", () => {
  it("reruns list resolver when explicit dep changes after resolution", async () => {
    const calls: string[] = [];
    const resolver = vi.fn(async (values: any) => {
      calls.push(values.filter);
      return [{ id: "u1", name: `User-for-${values.filter}`, role: "user" }];
    });

    const store = new Palistor({
      config: {
        filter: { value: "admin" },
        users: [
          userTemplate,
          { resolve: { resolver, onError: vi.fn(), deps: ["filter"] } },
        ],
      } as any,
    });

    // Trigger lazy resolve
    void (store.proxy as any).users.items;
    await flushPromises();

    expect(calls).toEqual(["admin"]);
    expect((store.proxy as any).users.length).toBe(1);
    expect((store.proxy as any).users.items[0].name.value).toBe("User-for-admin");

    // Change the dep field — resolver should retrigger
    (store.proxy as any).filter.value = "moderator";
    await flushPromises();

    expect(calls).toEqual(["admin", "moderator"]);
    expect((store.proxy as any).users.items[0].name.value).toBe("User-for-moderator");
  });

  it("reruns list resolver after completion when dep changes while pending", async () => {
    const calls: string[] = [];
    let resolveSecond!: (v: any) => void;
    let callIndex = 0;

    const resolver = vi.fn(async (values: any) => {
      callIndex++;
      const thisCall = callIndex;
      if (thisCall === 2) {
        return new Promise<any>((r) => { resolveSecond = r; });
      }
      calls.push(values.filter);
      return [{ id: "u1", name: `User-for-${values.filter}`, role: "user" }];
    });

    const store = new Palistor({
      config: {
        filter: { value: "a" },
        users: [
          userTemplate,
          { resolve: { resolver, onError: vi.fn(), deps: ["filter"] } },
        ],
      } as any,
    });

    // Initial resolve
    void (store.proxy as any).users.items;
    await flushPromises();
    expect(calls).toEqual(["a"]);

    // Change dep → triggers call 2 (paused)
    (store.proxy as any).filter.value = "b";
    await Promise.resolve();

    // Change dep again while call 2 is still pending
    (store.proxy as any).filter.value = "c";
    await Promise.resolve();

    // Resolve call 2 with stale result
    resolveSecond([{ id: "u1", name: "User-for-b", role: "user" }]);
    await flushPromises();

    // System should detect dep changed during pending and rerun with "c"
    expect(resolver).toHaveBeenCalledTimes(3);
    expect(calls).toEqual(["a", "c"]);
    expect((store.proxy as any).users.items[0].name.value).toBe("User-for-c");
  });
});
