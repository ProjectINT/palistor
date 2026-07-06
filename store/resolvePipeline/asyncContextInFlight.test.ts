/**
 * Regression: a `setContext` that happens WHILE a resolver is in flight must
 * not be lost.
 *
 * `executeResolve` captures `store.context` by reference at the start of an
 * attempt; `setContext` replaces the context object, so reads after an `await`
 * observe a stale snapshot. And the `setContext` re-trigger path
 * (`retriggerByPaths`) skips resolvers whose status is `pending` and — unlike
 * the value-dependency path in the notification hook — does not mark them with
 * `pendingRetrigger`. So a context change during an in-flight resolver was
 * neither observed nor re-run, leaving the resolved data permanently stale.
 *
 * The fix compares the accessed context keys against the live context when the
 * resolver returns and re-runs when they differ. Per-attempt snapshot semantics
 * are preserved (consistent with the values snapshot); consistency is restored
 * via the re-run.
 */
import { describe, it, expect, vi } from "vitest";
import { Palistor } from "../store";

function flush() {
  return new Promise<void>((r) => setTimeout(r, 0));
}

const userTemplate = { id: { value: "" }, name: { value: "" }, role: { value: "user" } };

describe("setContext during an in-flight resolver", () => {
  it("re-runs the resolver so the final state reflects the latest context", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const seen: Array<{ before: unknown; after: unknown }> = [];

    const resolver = vi.fn(async (_values: unknown, store: any) => {
      const before = store.context.token; // registers the $context.token dep
      await gate;                          // stay pending across a context change
      const after = store.context.token;
      seen.push({ before, after });
      return [{ id: "u1", name: String(after ?? "none"), role: "user" }];
    });

    const store = new Palistor({
      config: { users: [userTemplate, { resolve: { resolver, onError: vi.fn() } }] } as any,
    });

    store.setContext({ token: "A" });

    // trigger lazy resolve; let it start and park on `gate`
    void (store.proxy as any).users.items;
    await flush();

    // context changes mid-flight
    store.setContext({ token: "B" });

    release();
    await flush();
    await flush();

    // per-attempt snapshot is preserved (the first run saw "A" throughout)
    expect(seen[0]).toEqual({ before: "A", after: "A" });
    // the mid-flight change is not lost — the resolver re-runs with fresh context
    expect(resolver.mock.calls.length).toBe(2);
    expect(seen[1]).toEqual({ before: "B", after: "B" });
    // and the resolved data reflects the latest context
    expect((store.proxy as any).users.items?.[0]?.name?.value).toBe("B");
  });

  it("re-runs when a VALUE the resolver read changes mid-flight (first run, auto-dep)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const seen: unknown[] = [];

    const resolver = vi.fn(async (values: any) => {
      const q = values.q; // auto-dep on "q" — unknown until this run completes
      await gate;
      seen.push(q);
      return [{ id: "u1", name: String(q), role: "user" }];
    });

    const store = new Palistor({
      config: { q: { value: "a" }, users: [userTemplate, { resolve: { resolver, onError: vi.fn() } }] } as any,
    });

    void (store.proxy as any).users.items;
    await flush();

    (store.proxy as any).q.value = "b"; // change the read value mid-flight
    release();
    await flush();
    await flush();

    expect(resolver.mock.calls.length).toBe(2);
    expect(seen).toEqual(["a", "b"]);
    expect((store.proxy as any).users.items?.[0]?.name?.value).toBe("b");
  });

  it("does not re-run when the in-flight VALUE change is unrelated to what the resolver read", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });

    const resolver = vi.fn(async (values: any) => {
      void values.q; // reads only "q"
      await gate;
      return [{ id: "u1", name: "x", role: "user" }];
    });

    const store = new Palistor({
      config: {
        q: { value: "a" },
        other: { value: "1" },
        users: [userTemplate, { resolve: { resolver, onError: vi.fn() } }],
      } as any,
    });

    void (store.proxy as any).users.items;
    await flush();

    (store.proxy as any).other.value = "2"; // unrelated field
    release();
    await flush();
    await flush();

    expect(resolver.mock.calls.length).toBe(1);
  });

  it("does not re-run when the in-flight context change is unrelated to what the resolver read", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });

    const resolver = vi.fn(async (_values: unknown, store: any) => {
      void store.context.token; // reads only `token`
      await gate;
      return [{ id: "u1", name: "x", role: "user" }];
    });

    const store = new Palistor({
      config: { users: [userTemplate, { resolve: { resolver, onError: vi.fn() } }] } as any,
    });

    store.setContext({ token: "A" });
    void (store.proxy as any).users.items;
    await flush();

    store.setContext({ unrelated: "z" }); // does not touch `token`
    release();
    await flush();
    await flush();

    expect(resolver.mock.calls.length).toBe(1);
  });
});

describe("in-flight change detection must use structural equality", () => {
  it("a resolver reading an array field runs exactly once when nothing changes (no infinite loop)", async () => {
    // Regression: getValues() returns a fresh structuredClone each call and
    // arrays are tracked as leaves, so a reference compare (!==) of two clones
    // of an unchanged array always differs → endless pendingRetrigger → OOM.
    const resolver = vi.fn(async (values: any) => {
      void values.tags; // array read — tracked as a leaf
      return [{ id: "u1", name: "Alice", role: "user" }];
    });

    const store = new Palistor({
      config: { tags: { value: ["a", "b"] }, users: [userTemplate, { resolve: { resolver, onError: vi.fn() } }] } as any,
    });

    void (store.proxy as any).users.items;
    await flush();
    await flush();
    await flush();

    expect(resolver.mock.calls.length).toBe(1);
  }, 3000);

  it("re-runs once when the array field actually changes mid-flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });

    const resolver = vi.fn(async (values: any) => {
      const tags = values.tags as string[];
      await gate;
      return [{ id: "u1", name: tags.join(","), role: "user" }];
    });

    const store = new Palistor({
      config: { tags: { value: ["a"] }, users: [userTemplate, { resolve: { resolver, onError: vi.fn() } }] } as any,
    });

    void (store.proxy as any).users.items;
    await flush();

    (store.proxy as any).tags.value = ["a", "b"]; // structural change
    release();
    await flush();
    await flush();

    expect(resolver.mock.calls.length).toBe(2);
    expect((store.proxy as any).users.items?.[0]?.name?.value).toBe("a,b");
  }, 3000);

  it("a resolver spreading values ({...values}) — reading the list it populates — does not loop", async () => {
    // {...values} reads every top-level key, including `users` (the list this
    // resolver writes). The in-flight check must snapshot values BEFORE applying
    // the resolver's own result, otherwise `users` (empty → populated) looks
    // changed and loops.
    const resolver = vi.fn(async (values: any) => {
      void { ...values };
      return [{ id: "u1", name: "Alice", role: "user" }];
    });

    const store = new Palistor({
      config: { q: { value: "x" }, users: [userTemplate, { resolve: { resolver, onError: vi.fn() } }] } as any,
    });

    void (store.proxy as any).users.items;
    await flush();
    await flush();
    await flush();

    expect(resolver.mock.calls.length).toBe(1);
  }, 3000);
});
