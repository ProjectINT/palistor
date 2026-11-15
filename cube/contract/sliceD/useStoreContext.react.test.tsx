/**
 * useStoreContext on a root form: the hook merges its object into
 * store.context on mount and on every new object; a resolver that read a
 * context key re-runs when the hook changes that key, and only then; the
 * context outlives the hook. New in the contract (Phase 2.2); the list
 * resolver case is sliceC/listResolveContext.test.tsx.
 */
import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Palistor, useStoreContext } from "@impl";

const flushPromises = () => new Promise<void>((r) => setTimeout(r, 0));

/** A root resolve that reads store.context.accountId; started lazily by reading a field. */
function makeStore() {
  const seen: unknown[] = [];
  const resolver = vi.fn(async (_values: unknown, store: any) => {
    seen.push(store.context.accountId);
    return { email: `${store.context.accountId}@acme.test` };
  });
  const config = {
    email: { value: "" },
    resolve: { resolver, onError: vi.fn() },
  };
  const store = new Palistor({ config: config as any });
  return { store, resolver, seen };
}

describe("useStoreContext on the root form", () => {
  it("mounting puts the object into store.context", async () => {
    const { store } = makeStore();
    renderHook(() => useStoreContext(store as any, { accountId: "acc-1", tenant: "acme" }));
    await act(async () => {});
    expect(store.context).toMatchObject({ accountId: "acc-1", tenant: "acme" });
  });

  it("a new object merges: changed keys are replaced, absent keys are kept", async () => {
    const { store } = makeStore();
    const { rerender } = renderHook(({ ctx }) => useStoreContext(store as any, ctx), {
      initialProps: { ctx: { accountId: "acc-1", tenant: "acme" } as Record<string, unknown> },
    });
    rerender({ ctx: { accountId: "acc-2" } });
    await act(async () => {});
    expect(store.context).toEqual({ accountId: "acc-2", tenant: "acme" });
  });

  it("the resolver sees the context and re-runs when the hook changes a key it read", async () => {
    const { store, resolver, seen } = makeStore();
    const { rerender } = renderHook(({ ctx }) => useStoreContext(store as any, ctx), {
      initialProps: { ctx: { accountId: "acc-1" } as Record<string, unknown> },
    });
    await act(async () => {});

    void (store.proxy as any).email.value; // lazy resolve
    await act(() => flushPromises());
    expect(seen).toEqual(["acc-1"]);
    expect(store.getValues()).toEqual({ email: "acc-1@acme.test" });

    rerender({ ctx: { accountId: "acc-2" } });
    await act(() => flushPromises());
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(seen).toEqual(["acc-1", "acc-2"]);
    expect(store.getValues()).toEqual({ email: "acc-2@acme.test" });
  });

  it("a key the resolver never read does not restart it", async () => {
    const { store, resolver } = makeStore();
    const { rerender } = renderHook(({ ctx }) => useStoreContext(store as any, ctx), {
      initialProps: { ctx: { accountId: "acc-1", theme: "dark" } as Record<string, unknown> },
    });
    await act(async () => {});
    void (store.proxy as any).email.value;
    await act(() => flushPromises());
    expect(resolver).toHaveBeenCalledTimes(1);

    rerender({ ctx: { accountId: "acc-1", theme: "light" } });
    await act(() => flushPromises());
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("the context stays after the hook's host unmounts", async () => {
    const { store } = makeStore();
    const host = renderHook(() => useStoreContext(store as any, { accountId: "acc-1" }));
    await act(async () => {});
    host.unmount();
    expect(store.context.accountId).toBe("acc-1");
  });
});
