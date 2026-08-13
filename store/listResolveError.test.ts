/**
 * Tests for the public list resolve-error surface:
 * `list.error` / `list.resolveStatus` / `list.reload()`.
 *
 * All three are pure projections of the existing `ResolveState` — no new state.
 * The cases below pin the two physically different write paths (root lists go
 * through `executeListResolve`, per-entity ones through
 * `ResolveManager.triggerEntityListResolve`) to the same public behavior.
 *
 * React reactivity is covered in `react/listResolveError.react.test.tsx`.
 */

import { describe, it, expect, vi } from "vitest";
import { Palistor } from "./store";
import { defineList } from "./defineList";

function flush() {
  return new Promise<void>((r) => setTimeout(r, 0));
}

/** Controllable promise: { promise, resolve, reject } */
function deferred<T = any>() {
  let resolveFn!: (v: T) => void;
  let rejectFn!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolveFn = res;
    rejectFn = rej;
  });
  return { promise, resolve: resolveFn, reject: rejectFn };
}

/** Root list `users` with the given resolver. */
function makeRootStore(resolver: (...a: any[]) => any) {
  return new Palistor({
    config: {
      users: defineList({
        template: { id: { value: "" }, name: { value: "" } },
        resolve: { resolver, onError: vi.fn() },
      }),
    } as any,
  });
}

/**
 * Per-entity list: root `users` (no resolver) whose template carries a
 * `contacts` list with the given resolver.
 */
function makeEntityStore(resolver: (...a: any[]) => any) {
  const store = new Palistor({
    config: {
      users: defineList({
        template: {
          id: { value: "" },
          name: { value: "" },
          contacts: defineList({
            template: { id: { value: "" }, phone: { value: "" } },
            resolve: { resolver, onError: vi.fn() },
          }),
        },
      }),
    } as any,
  });
  store.set({ id: "u1", name: "Alice" });
  (store.proxy as any).users.add("u1");
  const contacts = (store.proxy as any).users.items[0].contacts;
  return { store, contacts };
}

// ─── 1. Failed resolve ────────────────────────────────────────────────────────

describe("failed list resolve", () => {
  it("exposes the thrown error, status \"error\", loading=false, items untouched", async () => {
    const boom = new Error("network down");
    const store = makeRootStore(async () => {
      throw boom;
    });
    const list = (store.proxy as any).users;

    // Pre-existing membership: a failed resolve must not clear it.
    store.set({ id: "u1", name: "Alice" });
    list.add("u1");

    expect(list.length).toBe(1); // also triggers the lazy resolve
    await flush();

    expect(list.error).toBe(boom);
    expect(list.resolveStatus).toBe("error");
    expect(list.loading).toBe(false);
    expect(list.items.map((i: any) => i.id)).toEqual(["u1"]);
  });

  it("error is null and status \"resolved\" on a successful run", async () => {
    const store = makeRootStore(async () => [{ id: "u1", name: "Alice" }]);
    const list = (store.proxy as any).users;

    void list.items;
    await flush();

    expect(list.error).toBeNull();
    expect(list.resolveStatus).toBe("resolved");
    expect(list.length).toBe(1);
  });

  it("status is \"idle\" before the first run", () => {
    const store = makeRootStore(async () => []);
    // Read a non-triggering key: `resolveStatus` itself must not start a resolve.
    expect((store.proxy as any).users.resolveStatus).toBe("idle");
    expect((store.proxy as any).users.error).toBeNull();
  });
});

// ─── 2. Recovery ──────────────────────────────────────────────────────────────

describe("recovery through reload()", () => {
  it("root list: fail → reload() → success clears the error and fills items", async () => {
    const boom = new Error("boom");
    let attempt = 0;
    const resolver = vi.fn(async () => {
      attempt++;
      if (attempt === 1) throw boom;
      return [{ id: "u1", name: "Alice" }];
    });
    const store = makeRootStore(resolver);
    const list = (store.proxy as any).users;

    void list.items;
    await flush();
    expect(list.error).toBe(boom);

    list.reload();
    await flush();

    expect(list.error).toBeNull();
    expect(list.resolveStatus).toBe("resolved");
    expect(list.length).toBe(1);
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it("per-entity list: fail → reload() → success clears the error and fills items", async () => {
    const boom = new Error("boom");
    let attempt = 0;
    const resolver = vi.fn(async () => {
      attempt++;
      if (attempt === 1) throw boom;
      return [{ id: "c1", phone: "+1" }];
    });
    const { contacts } = makeEntityStore(resolver);

    void contacts.items;
    await flush();

    // Blocker A regression guard: the per-entity catch path must store the
    // error, not just the status.
    expect(contacts.error).toBe(boom);
    expect(contacts.resolveStatus).toBe("error");
    expect(contacts.loading).toBe(false);

    contacts.reload();
    await flush();

    expect(contacts.error).toBeNull();
    expect(contacts.resolveStatus).toBe("resolved");
    expect(contacts.items.map((c: any) => c.id)).toEqual(["c1"]);
    expect(resolver).toHaveBeenCalledTimes(2);
  });
});

// ─── 3. reload() semantics ────────────────────────────────────────────────────

describe("reload() semantics", () => {
  it("root list: re-runs from \"error\" and from \"resolved\"", async () => {
    let attempt = 0;
    const resolver = vi.fn(async () => {
      attempt++;
      if (attempt === 1) throw new Error("boom");
      return [{ id: "u1", name: "Alice" }];
    });
    const store = makeRootStore(resolver);
    const list = (store.proxy as any).users;

    void list.items;
    await flush();
    expect(list.resolveStatus).toBe("error");

    list.reload(); // from "error"
    await flush();
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(list.resolveStatus).toBe("resolved");

    list.reload(); // from "resolved"
    await flush();
    expect(resolver).toHaveBeenCalledTimes(3);
  });

  it("per-entity list: re-runs from \"resolved\" (Blocker B regression guard)", async () => {
    const resolver = vi.fn(async () => [{ id: "c1", phone: "+1" }]);
    const { contacts } = makeEntityStore(resolver);

    void contacts.items;
    await flush();
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(contacts.resolveStatus).toBe("resolved");

    contacts.reload();
    await flush();
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(contacts.resolveStatus).toBe("resolved");
  });

  it("root list: reload() while \"pending\" does not spawn a parallel run", async () => {
    const d = deferred<any[]>();
    const resolver = vi.fn(() => d.promise);
    const store = makeRootStore(resolver);
    const list = (store.proxy as any).users;

    void list.items;
    await Promise.resolve();
    expect(list.resolveStatus).toBe("pending");

    list.reload();
    list.reload();
    expect(resolver).toHaveBeenCalledTimes(1);

    d.resolve([{ id: "u1", name: "Alice" }]);
    await flush();
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("per-entity list: reload() while \"pending\" does not spawn a parallel run", async () => {
    const d = deferred<any[]>();
    const resolver = vi.fn(() => d.promise);
    const { contacts } = makeEntityStore(resolver);

    void contacts.items;
    await Promise.resolve();
    expect(contacts.resolveStatus).toBe("pending");

    contacts.reload();
    contacts.reload();
    expect(resolver).toHaveBeenCalledTimes(1);

    d.resolve([{ id: "c1", phone: "+1" }]);
    await flush();
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("is a stable reference and a no-op on a list without a resolver", () => {
    const store = new Palistor({
      config: { users: [{ id: { value: "" }, name: { value: "" } }] } as any,
    });
    const list = (store.proxy as any).users;

    expect(list.reload).toBe(list.reload);
    expect(() => list.reload()).not.toThrow();
    expect(list.resolveStatus).toBe("idle");
    expect(list.error).toBeNull();
  });
});

// ─── 4. Per-entity parity ─────────────────────────────────────────────────────

describe("per-entity list resolve state", () => {
  it("keeps error and resolveStatus coherent while pending", async () => {
    const d = deferred<any[]>();
    const { contacts } = makeEntityStore(() => d.promise);

    void contacts.items;
    await Promise.resolve();

    expect(contacts.resolveStatus).toBe("pending");
    expect(contacts.loading).toBe(true);
    expect(contacts.error).toBeNull();

    d.resolve([]);
    await flush();
    expect(contacts.resolveStatus).toBe("resolved");
  });

  it("clears a previous error while the forced re-run is in flight", async () => {
    const boom = new Error("boom");
    const d = deferred<any[]>();
    let attempt = 0;
    const { contacts } = makeEntityStore(() => {
      attempt++;
      if (attempt === 1) return Promise.reject(boom);
      return d.promise;
    });

    void contacts.items;
    await flush();
    expect(contacts.error).toBe(boom);

    contacts.reload();
    await Promise.resolve();
    expect(contacts.resolveStatus).toBe("pending");
    expect(contacts.error).toBeNull();

    d.resolve([{ id: "c1", phone: "+1" }]);
    await flush();
    expect(contacts.error).toBeNull();
  });

  it("isolates resolve state between two owners of the same list config", async () => {
    const boom = new Error("only u2 fails");
    const resolver = vi.fn(async (parent: any) => {
      if (parent.id === "u2") throw boom;
      return [{ id: "c1", phone: "+1" }];
    });
    const store = new Palistor({
      config: {
        users: defineList({
          template: {
            id: { value: "" },
            name: { value: "" },
            contacts: defineList({
              template: { id: { value: "" }, phone: { value: "" } },
              resolve: { resolver, onError: vi.fn() },
            }),
          },
        }),
      } as any,
    });
    store.set({ id: "u1", name: "Alice" });
    store.set({ id: "u2", name: "Bob" });
    (store.proxy as any).users.setItems(["u1", "u2"]);

    const c1 = (store.proxy as any).users.items[0].contacts;
    const c2 = (store.proxy as any).users.items[1].contacts;
    void c1.items;
    void c2.items;
    await flush();

    expect(c1.error).toBeNull();
    expect(c1.resolveStatus).toBe("resolved");
    expect(c2.error).toBe(boom);
    expect(c2.resolveStatus).toBe("error");
  });
});

// ─── 5. Spread ────────────────────────────────────────────────────────────────

describe("spread keys", () => {
  it("root list spread contains error, resolveStatus, reload", () => {
    const store = makeRootStore(async () => []);
    const keys = Object.keys({ ...((store.proxy as any).users as object) });
    expect(keys).toContain("error");
    expect(keys).toContain("resolveStatus");
    expect(keys).toContain("reload");
  });

  it("per-entity list spread contains error, resolveStatus, reload", () => {
    const { contacts } = makeEntityStore(async () => []);
    const keys = Object.keys({ ...(contacts as object) });
    expect(keys).toContain("error");
    expect(keys).toContain("resolveStatus");
    expect(keys).toContain("reload");
  });
});

// ─── 6. fieldMapping guard (Blocker C) ────────────────────────────────────────

describe("fieldMapping does not shadow the list-only keys", () => {
  it("list.error still returns the resolve error under { isInvalid: \"error\" }", async () => {
    const boom = new Error("boom");
    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: {
            resolver: async () => {
              throw boom;
            },
            onError: vi.fn(),
          },
        }),
      } as any,
      fieldMapping: { isInvalid: "error" },
    });
    const list = (store.proxy as any).users;

    void list.items;
    await flush();

    // Without the raw-key match, `error` would be translated to `isInvalid`,
    // fall through the switch and read as undefined.
    expect(list.error).toBe(boom);
    expect(list.resolveStatus).toBe("error");
    expect(typeof list.reload).toBe("function");
  });

  it("mapped list keys (loading → isLoading) keep working alongside", async () => {
    const d = deferred<any[]>();
    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver: () => d.promise, onError: vi.fn() },
        }),
      } as any,
      fieldMapping: { loading: "isLoading", isInvalid: "error" },
    });
    const list = (store.proxy as any).users;

    void list.items;
    await Promise.resolve();

    expect(list.isLoading).toBe(true);
    expect(list.error).toBeNull();

    d.resolve([]);
    await flush();
    expect(list.isLoading).toBe(false);
  });
});
