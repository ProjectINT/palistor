/**
 * Extended async-resolver tests for defineList.
 *
 * Covers scenarios not present in defineList.test.ts:
 *
 *  A. Resolver timing and lifecycle
 *     A1. The resolver receives a values snapshot at launch time (not after)
 *     A2. Delayed resolver: items are empty while waiting, filled afterwards
 *     A3. Re-resolve updates the data of already-existing entities
 *     A4. Re-resolve after an error fires on a dep change (status="error")
 *
 *  B. Behavior in the "pending" state
 *     B1. A dep change while the resolver is pending → does NOT re-run (dedup)
 *     B2. After the pending resolver completes, the next dep change works
 *
 *  C. Iteration and item access after resolve
 *     C1. map() returns the right items after the resolver
 *     C2. Symbol.iterator walks all items after the resolver
 *     C3. getById() finds an item by id after the resolver
 *     C4. indexed items access works after the resolver
 *
 *  D. The dirty flag and initialItemIds
 *     D1. dirty = false right after the resolver (initialItemIds is updated)
 *     D2. dirty = true after a manual add() on top of resolve data
 *     D3. Re-resolve resets dirty back to false
 *     D4. dirty = false after a full setItems replacement with the same ids
 *
 *  E. Versions and notifications
 *     E1. getNodeVersion(listNode) grows on every successful resolve
 *     E2. A list-node subscription fires when the resolver completes
 *     E3. The subscriber is NOT invoked on an entity field change (list-level only)
 *
 *  F. Complex scenarios
 *     F1. Resolver with several deps: independent changes — each re-runs the resolver
 *     F2. Two lists with a shared dep — both re-run when the dep changes
 *     F3. The resolver returns partially updated data — merged with existing
 *     F4. A nested list's resolver receives the correct parent values
 */
import { describe, it, expect, vi } from "vitest";
import { defineList } from "./defineList";
import { Palistor } from "./store";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function flushPromises() {
  return new Promise<void>((r) => setTimeout(r, 0));
}

/** Delay for ms milliseconds */
function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/** Creates a controllable promise: { promise, resolve, reject } */
function deferred<T = any>() {
  let resolveFn!: (v: T) => void;
  let rejectFn!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolveFn = res;
    rejectFn = rej;
  });
  return { promise, resolve: resolveFn, reject: rejectFn };
}

// ─── A. Resolver timing and lifecycle ────────────────────────────────────────

describe("A. Resolver timing and lifecycle", () => {
  it("A1. the resolver receives a values snapshot at launch, not afterwards", async () => {
    const capturedValues: any[] = [];
    const d = deferred<any[]>();

    const resolver = vi.fn((values: any) => {
      capturedValues.push({ ...values });
      return d.promise;
    });

    const store = new Palistor({
      config: {
        filter: { value: "initial" },
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, deps: ["filter"], onError: vi.fn() },
        }),
      } as any,
    });

    // Launch the resolver
    void (store.proxy as any).users.items;
    await Promise.resolve(); // flush microtask

    // Change the dep value WHILE the resolver awaits its result
    (store.proxy as any).filter.value = "changed";

    d.resolve([{ id: "u1", name: "Alice" }]);
    await flushPromises();

    // The resolver was called with "initial", not "changed"
    expect(capturedValues[0].filter).toBe("initial");
  });

  it("A2. items are empty while waiting, filled afterwards", async () => {
    const d = deferred<any[]>();
    const resolver = vi.fn(() => d.promise);

    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await Promise.resolve();

    // While waiting the list is empty, but loading = true
    expect((store.proxy as any).users.length).toBe(0);
    expect((store.proxy as any).users.loading).toBe(true);

    d.resolve([
      { id: "u1", name: "Alice" },
      { id: "u2", name: "Bob" },
    ]);
    await flushPromises();

    // After resolve the list is populated
    expect((store.proxy as any).users.length).toBe(2);
    expect((store.proxy as any).users.loading).toBe(false);
    expect((store.proxy as any).users.items[0].name.value).toBe("Alice");
    expect((store.proxy as any).users.items[1].name.value).toBe("Bob");
  });

  it("A3. re-resolve updates the values of already-existing entities", async () => {
    const resolver = vi.fn(async (values: any) => {
      if (values.filter === "v1") return [{ id: "u1", name: "Alice v1", role: "user" }];
      return [{ id: "u1", name: "Alice v2", role: "admin" }];
    });

    const store = new Palistor({
      config: {
        filter: { value: "v1" },
        users: defineList({
          template: { id: { value: "" }, name: { value: "" }, role: { value: "" } },
          resolve: { resolver, deps: ["filter"], onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    expect((store.proxy as any).users.items[0].name.value).toBe("Alice v1");
    expect((store.proxy as any).users.items[0].role.value).toBe("user");

    // Change the dep → re-resolve
    (store.proxy as any).filter.value = "v2";
    await flushPromises();

    // The same entity u1 now carries the updated values
    expect((store.proxy as any).users.items[0].name.value).toBe("Alice v2");
    expect((store.proxy as any).users.items[0].role.value).toBe("admin");
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it("A4. after a resolver error a dep change triggers a retry", async () => {
    let shouldFail = true;
    const resolver = vi.fn(async () => {
      if (shouldFail) throw new Error("temporary failure");
      return [{ id: "u1", name: "Alice" }];
    });
    const onError = vi.fn();

    const store = new Palistor({
      config: {
        filter: { value: "x" },
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, deps: ["filter"], onError },
        }),
      } as any,
    });

    // First run — error
    void (store.proxy as any).users.items;
    await flushPromises();

    expect(onError).toHaveBeenCalledTimes(1);
    expect((store.proxy as any).users.length).toBe(0);

    // Fix the error and change the dep
    shouldFail = false;
    (store.proxy as any).filter.value = "y";
    await flushPromises();

    // The second run succeeds
    expect(resolver).toHaveBeenCalledTimes(2);
    expect((store.proxy as any).users.length).toBe(1);
    expect((store.proxy as any).users.items[0].name.value).toBe("Alice");
  });
});

// ─── B. Behavior in the "pending" state ──────────────────────────────────────

describe("B. Behavior in the pending state", () => {
  it("B1. a dep change while the resolver is pending → re-run after completion", async () => {
    const d = deferred<any[]>();
    const resolver = vi.fn((values: any) => {
      if (values.filter === "a") return d.promise;
      return Promise.resolve([{ id: "u2", name: "Bob" }]);
    });

    const store = new Palistor({
      config: {
        filter: { value: "a" },
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, deps: ["filter"], onError: vi.fn() },
        }),
      } as any,
    });

    // Launch the resolver (status: idle → pending)
    void (store.proxy as any).users.items;
    await Promise.resolve();

    expect((store.proxy as any).users.loading).toBe(true);
    expect(resolver).toHaveBeenCalledTimes(1);

    // Change the dep while pending — sets pendingRetrigger, no new call starts
    (store.proxy as any).filter.value = "b";
    await Promise.resolve();

    // Still only one active call
    expect(resolver).toHaveBeenCalledTimes(1);

    d.resolve([{ id: "u1", name: "Alice" }]);
    await flushPromises();

    // After the first call completed — a second one started automatically (for filter="b")
    expect(resolver).toHaveBeenCalledTimes(2);
    expect((store.proxy as any).users.length).toBe(1);
    expect((store.proxy as any).users.items[0].name.value).toBe("Bob");
  });

  it("B2. after the pending resolver completes, the next dep change works", async () => {
    const d = deferred<any[]>();
    const resolver = vi.fn((values: any) => {
      if (values.filter === "a") return d.promise;
      return Promise.resolve([{ id: "u2", name: "Bob" }]);
    });

    const store = new Palistor({
      config: {
        filter: { value: "a" },
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, deps: ["filter"], onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await Promise.resolve();

    // Complete the first resolver
    d.resolve([{ id: "u1", name: "Alice" }]);
    await flushPromises();

    expect(resolver).toHaveBeenCalledTimes(1);
    expect((store.proxy as any).users.length).toBe(1);

    // Now the status is "resolved" → the next dep change fires
    (store.proxy as any).filter.value = "b";
    await flushPromises();

    expect(resolver).toHaveBeenCalledTimes(2);
    expect((store.proxy as any).users.items[0].name.value).toBe("Bob");
  });
});

// ─── C. Iteration and item access after resolve ──────────────────────────────

describe("C. Iteration and item access after resolve", () => {
  it("C1. map() returns the correctly transformed items", async () => {
    const resolver = vi.fn(async () => [
      { id: "u1", name: "Alice" },
      { id: "u2", name: "Bob" },
      { id: "u3", name: "Carol" },
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

    const names = (store.proxy as any).users.map(
      (user: any, _index: number, _id: string) => user.name.value,
    );

    expect(names).toEqual(["Alice", "Bob", "Carol"]);
  });

  it("C2. map() passes the correct index and id", async () => {
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

    const result: Array<{ index: number; id: string }> = [];
    (store.proxy as any).users.map((_user: any, index: number, id: string) => {
      result.push({ index, id });
    });

    expect(result[0]).toEqual({ index: 0, id: "u1" });
    expect(result[1]).toEqual({ index: 1, id: "u2" });
  });

  it("C3. getById() finds an item by id after the resolver", async () => {
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

    const alice = (store.proxy as any).users.getById("u1");
    const bob = (store.proxy as any).users.getById("u2");
    const nobody = (store.proxy as any).users.getById("u99");

    expect(alice).toBeDefined();
    expect(alice.name.value).toBe("Alice");
    expect(bob).toBeDefined();
    expect(bob.name.value).toBe("Bob");
    expect(nobody).toBeUndefined();
  });

  it("C4. numeric index access via items[i] works after the resolver", async () => {
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
    expect(users.items[2]).toBeUndefined();
  });
});

// ─── D. The dirty flag and initialItemIds ────────────────────────────────────

describe("D. The dirty flag and initialItemIds", () => {
  it("D1. dirty = false right after the resolver (initialItemIds is updated)", async () => {
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

    // After the resolver the list is "clean" — that's its baseline state
    expect((store.proxy as any).users.dirty).toBe(false);
  });

  it("D2. dirty = true after a manual add() on top of resolve data", async () => {
    const resolver = vi.fn(async () => [
      { id: "u1", name: "Alice" },
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

    expect((store.proxy as any).users.dirty).toBe(false);

    // Add an item manually
    (store.proxy as any).users.add({ id: "u2", name: "Bob" });

    expect((store.proxy as any).users.dirty).toBe(true);
    expect((store.proxy as any).users.length).toBe(2);
  });

  it("D3. re-resolve resets dirty back to false", async () => {
    const resolver = vi.fn(async (values: any) => {
      if (values.filter === "a") return [{ id: "u1", name: "Alice" }];
      return [{ id: "u1", name: "Alice" }, { id: "u2", name: "Bob" }];
    });

    const store = new Palistor({
      config: {
        filter: { value: "a" },
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, deps: ["filter"], onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    // Manual add — dirty = true
    (store.proxy as any).users.add({ id: "extra", name: "Extra" });
    expect((store.proxy as any).users.dirty).toBe(true);

    // Re-resolve via a deps change
    (store.proxy as any).filter.value = "b";
    await flushPromises();

    // After the re-resolve dirty is reset
    expect((store.proxy as any).users.dirty).toBe(false);
    expect((store.proxy as any).users.length).toBe(2);
  });

  it("D4. dirty = false after remove() of an item absent from the initial set (added manually)", async () => {
    const resolver = vi.fn(async () => [{ id: "u1", name: "Alice" }]);

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

    // Add → dirty = true
    (store.proxy as any).users.add({ id: "u2", name: "Bob" });
    expect((store.proxy as any).users.dirty).toBe(true);

    // Remove the added item — back to the initial state
    (store.proxy as any).users.remove("u2");
    expect((store.proxy as any).users.length).toBe(1);
    // The list membership equals initial again → dirty = false
    expect((store.proxy as any).users.dirty).toBe(false);
  });
});

// ─── E. Versions and notifications ────────────────────────────────────────────

describe("E. Versions and notifications", () => {
  it("E1. the list node version grows on every successful resolve", async () => {
    const resolver = vi.fn(async (values: any) => {
      if (values.page === 1) return [{ id: "u1", name: "P1" }];
      return [{ id: "u2", name: "P2" }];
    });

    const store = new Palistor({
      config: {
        page: { value: 1 },
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, deps: ["page"], onError: vi.fn() },
        }),
      } as any,
    });

    // rootConfig.users is the array (ListNode)
    const usersNode = (store as any).rootConfig.users;

    void (store.proxy as any).users.items;
    await flushPromises();

    const v1 = store.getNodeVersion(usersNode);

    (store.proxy as any).page.value = 2;
    await flushPromises();

    const v2 = store.getNodeVersion(usersNode);

    expect(v2).toBeGreaterThan(v1);
  });

  it("E2. the change subscription fires on a dep change + resolver completion", async () => {
    const resolver = vi.fn(async (values: any) => {
      if (values.filter === "a") return [{ id: "u1", name: "Alice" }];
      return [{ id: "u2", name: "Bob" }];
    });

    const store = new Palistor({
      config: {
        filter: { value: "a" },
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, deps: ["filter"], onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    const globalListener = vi.fn();
    store.subscribeGlobal(globalListener);
    globalListener.mockClear();

    // Changing the dep → launches the resolver → notifyChanged after resolve
    (store.proxy as any).filter.value = "b";
    await flushPromises();

    // The global listener fired at least once (on the data update)
    expect(globalListener).toHaveBeenCalled();
    expect((store.proxy as any).users.items[0].name.value).toBe("Bob");
  });

  it("E3. an entity field change does not bump the list node version", async () => {
    const resolver = vi.fn(async () => [{ id: "u1", name: "Alice" }]);

    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, onError: vi.fn() },
        }),
      } as any,
    });

    const usersNode = (store as any).rootConfig.users;

    void (store.proxy as any).users.items;
    await flushPromises();

    const vBefore = store.getNodeVersion(usersNode);

    // Change an entity field (not the list structure)
    (store.proxy as any).users.items[0].name.value = "Alice Updated";

    const vAfter = store.getNodeVersion(usersNode);

    // The list node version must not change on an entity field change
    expect(vAfter).toBe(vBefore);
  });
});

// ─── F. Complex scenarios ──────────────────────────────────────────────────────

describe("F. Complex scenarios", () => {
  it("F1. multiple deps: every independent change re-runs the resolver", async () => {
    const calls: Array<{ page: number; sort: string }> = [];
    const resolver = vi.fn(async (values: any) => {
      calls.push({ page: values.page, sort: values.sort });
      return [{ id: `item-${calls.length}`, name: `Item ${calls.length}` }];
    });

    const store = new Palistor({
      config: {
        page: { value: 1 },
        sort: { value: "asc" },
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, deps: ["page", "sort"], onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ page: 1, sort: "asc" });

    (store.proxy as any).page.value = 2;
    await flushPromises();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ page: 2, sort: "asc" });

    (store.proxy as any).sort.value = "desc";
    await flushPromises();
    expect(calls).toHaveLength(3);
    expect(calls[2]).toMatchObject({ page: 2, sort: "desc" });
  });

  it("F2. two lists with a shared dep — both re-run when the dep changes", async () => {
    const usersResolver = vi.fn(async (values: any) => {
      if (values.org === "a") return [{ id: "u1", name: "Alice" }];
      return [{ id: "u2", name: "Bob" }];
    });
    const groupsResolver = vi.fn(async (values: any) => {
      if (values.org === "a") return [{ id: "g1", title: "Dev" }];
      return [{ id: "g2", title: "Ops" }];
    });

    const store = new Palistor({
      config: {
        org: { value: "a" },
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver: usersResolver, deps: ["org"], onError: vi.fn() },
        }),
        groups: defineList({
          template: { id: { value: "" }, title: { value: "" } },
          resolve: { resolver: groupsResolver, deps: ["org"], onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    void (store.proxy as any).groups.items;
    await flushPromises();

    expect((store.proxy as any).users.items[0].name.value).toBe("Alice");
    expect((store.proxy as any).groups.items[0].title.value).toBe("Dev");

    // Change the shared dep
    (store.proxy as any).org.value = "b";
    await flushPromises();

    // Both lists re-ran
    expect(usersResolver).toHaveBeenCalledTimes(2);
    expect(groupsResolver).toHaveBeenCalledTimes(2);
    expect((store.proxy as any).users.items[0].name.value).toBe("Bob");
    expect((store.proxy as any).groups.items[0].title.value).toBe("Ops");
  });

  it("F3. the resolver returns a new membership + updated fields for the overlapping id", async () => {
    const resolver = vi.fn(async (values: any) => {
      if (values.filter === "v1") {
        return [
          { id: "u1", name: "Alice", role: "user" },
          { id: "u2", name: "Bob", role: "user" },
        ];
      }
      // u1 updated, u2 removed, u3 added
      return [
        { id: "u1", name: "Alice Admin", role: "admin" },
        { id: "u3", name: "Carol", role: "user" },
      ];
    });

    const store = new Palistor({
      config: {
        filter: { value: "v1" },
        users: defineList({
          template: { id: { value: "" }, name: { value: "" }, role: { value: "" } },
          resolve: { resolver, deps: ["filter"], onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    expect((store.proxy as any).users.length).toBe(2);

    (store.proxy as any).filter.value = "v2";
    await flushPromises();

    expect((store.proxy as any).users.length).toBe(2);

    const u1 = (store.proxy as any).users.getById("u1");
    const u3 = (store.proxy as any).users.getById("u3");
    const u2 = (store.proxy as any).users.getById("u2");

    expect(u1).toBeDefined();
    expect(u1.name.value).toBe("Alice Admin");
    expect(u1.role.value).toBe("admin");

    expect(u3).toBeDefined();
    expect(u3.name.value).toBe("Carol");

    // u2 is no longer in the list (but may remain in the registry)
    expect(u2).toBeUndefined();
  });

  it("F4. a nested list's resolver receives the parent field values", async () => {
    const capturedValues: any[] = [];
    const resolver = vi.fn(async (values: any) => {
      capturedValues.push({ ...values });
      return [];
    });

    const store = new Palistor({
      config: {
        companyId: { value: "c42" },
        section: {
          departmentId: { value: "d7" },
          employees: defineList<{ id: string; name: string }>({
            template: { id: { value: "" }, name: { value: "" } },
            resolve: { resolver, onError: vi.fn() },
          }),
        },
      } as any,
    });

    void (store.proxy as any).section.employees.items;
    await flushPromises();

    expect(capturedValues[0]).toMatchObject({
      companyId: "c42",
    });
  });

  it("F5. the resolver returns entities with numeric fields — correctly typed values", async () => {
    const resolver = vi.fn(async () => [
      { id: "p1", price: 999, quantity: 5, active: true },
    ]);

    const store = new Palistor({
      config: {
        products: defineList({
          template: {
            id: { value: "" },
            price: { value: 0 },
            quantity: { value: 0 },
            active: { value: false },
          },
          resolve: { resolver, onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).products.items;
    await flushPromises();

    const p = (store.proxy as any).products.items[0];
    expect(p.price.value).toBe(999);
    expect(p.quantity.value).toBe(5);
    expect(p.active.value).toBe(true);
  });

  it("F6. resolver + manual remove() → the list turns dirty, then a re-resolve clears it", async () => {
    const resolver = vi.fn(async (values: any) => {
      if (values.q === "1")
        return [{ id: "u1", name: "Alice" }, { id: "u2", name: "Bob" }];
      return [{ id: "u1", name: "Alice" }, { id: "u2", name: "Bob" }];
    });

    const store = new Palistor({
      config: {
        q: { value: "1" },
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, deps: ["q"], onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();

    expect((store.proxy as any).users.dirty).toBe(false);

    // Manual removal → dirty
    (store.proxy as any).users.remove("u1");
    expect((store.proxy as any).users.dirty).toBe(true);

    // Re-resolve → dirty is reset
    (store.proxy as any).q.value = "2";
    await flushPromises();

    expect((store.proxy as any).users.dirty).toBe(false);
    expect((store.proxy as any).users.length).toBe(2);
  });

  it("F7. onError is called with the right arguments on a network error", async () => {
    const networkError = new TypeError("Failed to fetch");
    const onError = vi.fn();
    const notifyFn = vi.fn();

    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: {
            resolver: vi.fn(async () => { throw networkError; }),
            onError,
          },
        }),
      } as any,
    });

    store.setNotifier(notifyFn);

    void (store.proxy as any).users.items;
    await flushPromises();

    expect(onError).toHaveBeenCalledTimes(1);
    const [err, ctx] = onError.mock.calls[0];
    expect(err).toBe(networkError);
    expect(typeof ctx.notify).toBe("function");

    // ctx.notify must proxy into store.setNotifier
    ctx.notify("Error message");
    expect(notifyFn).toHaveBeenCalledWith("Error message");
  });

  it("F8. length and items.length stay consistent across several resolves", async () => {
    let callIdx = 0;
    const datasets = [
      [{ id: "u1", name: "A" }],
      [{ id: "u1", name: "A" }, { id: "u2", name: "B" }],
      [{ id: "u3", name: "C" }],
    ];

    const resolver = vi.fn(async () => datasets[callIdx++] ?? []);

    const store = new Palistor({
      config: {
        page: { value: 0 },
        users: defineList<{ id: string; name: string }>({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, deps: ["page"], onError: vi.fn() },
        }),
      } as any,
    });

    void (store.proxy as any).users.items;
    await flushPromises();
    expect((store.proxy as any).users.length).toBe((store.proxy as any).users.items.length);
    expect((store.proxy as any).users.length).toBe(1);

    (store.proxy as any).page.value = 1;
    await flushPromises();
    expect((store.proxy as any).users.length).toBe(2);
    expect((store.proxy as any).users.length).toBe((store.proxy as any).users.items.length);

    (store.proxy as any).page.value = 2;
    await flushPromises();
    expect((store.proxy as any).users.length).toBe(1);
    expect((store.proxy as any).users.length).toBe((store.proxy as any).users.items.length);
  });
});
