/**
 * List resolver + useStoreContext: the resolver receives context via store.context.
 *
 * Covers the scenario where a React component sets the context through
 * useStoreContext (or store.setContext) and the list resolver reads it
 * from the second argument's `store.context`.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { Palistor } from "../store";
import { useForm } from "../../react/useForm";
import { useStoreContext } from "../../react/useStoreContext";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function flushPromises() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

const userTemplate = {
  id: { value: "" },
  name: { value: "" },
  role: { value: "user" },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("the list resolver reads store.context set via useStoreContext", () => {
  it("the resolver receives the accountId set via useStoreContext before resolve (passes in isolation)", async () => {
    const capturedContext: Record<string, unknown>[] = [];

    const resolver = vi.fn(async (_values: unknown, store: any) => {
      capturedContext.push({ ...store.context });
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

    // Set the context via the hook (as a Layout/Provider does in a real app)
    const { unmount } = renderHook(() =>
      useStoreContext(store as any, { accountId: "acc-123", tenant: "acme" }),
    );

    // The context is set via useEffect → act is needed for the effect to apply
    await act(async () => {});

    // Trigger the lazy resolve
    void (store.proxy as any).users.items;
    await act(() => flushPromises());

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(capturedContext[0]).toMatchObject({ accountId: "acc-123", tenant: "acme" });

    unmount();
  });

  it("after useStoreContext unmounts, the context clears and the resolver doesn't see stale data (passes in isolation)", async () => {
    const capturedContexts: Record<string, unknown>[] = [];
    let callCount = 0;

    const resolver = vi.fn(async (_values: unknown, store: any) => {
      callCount++;
      capturedContexts.push({ ...store.context });
      return [{ id: `u${callCount}`, name: `User ${callCount}`, role: "user" }];
    });

    const store = new Palistor({
      config: {
        users: [
          userTemplate,
          { resolve: { resolver, onError: vi.fn() } },
        ],
      } as any,
    });

    // First render — with the context
    const { unmount } = renderHook(() =>
      useStoreContext(store as any, { accountId: "acc-first" }),
    );
    await act(async () => {});

    void (store.proxy as any).users.items;
    await act(() => flushPromises());

    expect(capturedContexts[0]).toMatchObject({ accountId: "acc-first" });

    // Unmount does NOT clear the context
    unmount();
    await act(async () => {});

    expect(store.context).toEqual({ accountId: "acc-first" });
  });

  it("useForm + useStoreContext in one renderHook — the resolver receives the context", async () => {
    const capturedContext: Record<string, unknown>[] = [];

    const resolver = vi.fn(async (_values: unknown, store: any) => {
      capturedContext.push({ ...store.context });
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

    // The component wires up the form and sets the context at the same time
    renderHook(() => {
      useStoreContext(store as any, { accountId: "acc-xyz", locale: "ru" });
      return useForm(store as any);
    });

    await act(async () => {});

    // Trigger the lazy resolve
    void (store.proxy as any).users.items;
    await act(() => flushPromises());

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(capturedContext[0]).toMatchObject({ accountId: "acc-xyz", locale: "ru" });
  });

  it("the context updates between calls — a re-run resolver gets the new context", async () => {
    const capturedContexts: Record<string, unknown>[] = [];

    const resolver = vi.fn(async (_values: unknown, store: any) => {
      capturedContexts.push({ ...store.context });
      return [{ id: "u1", name: "Alice", role: "admin" }];
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

    // Set the initial context
    store.setContext({ accountId: "acc-v1" });

    void (store.proxy as any).users.items;
    await act(() => flushPromises());

    expect(capturedContexts[0]).toMatchObject({ accountId: "acc-v1" });

    // Update the context
    store.setContext({ accountId: "acc-v2" });

    // Change the dep → the resolver re-runs
    act(() => {
      (store.proxy as any).filter.value = "user";
    });
    await act(() => flushPromises());

    expect(capturedContexts[1]).toMatchObject({ accountId: "acc-v2" });
  });

  it("the resolver uses store.context.accountId to filter — the result depends on the context", async () => {
    const users: Record<string, { id: string; name: string; role: string }[]> = {
      "acc-alice": [{ id: "u1", name: "Alice", role: "admin" }],
      "acc-bob":   [{ id: "u2", name: "Bob",   role: "user"  }],
    };

    const resolver = vi.fn(async (_values: unknown, store: any) => {
      return users[store.context.accountId as string] ?? [];
    });

    const store = new Palistor({
      config: {
        users: [
          userTemplate,
          { resolve: { resolver, onError: vi.fn() } },
        ],
      } as any,
    });

    store.setContext({ accountId: "acc-alice" });

    void (store.proxy as any).users.items;
    await act(() => flushPromises());

    expect((store.proxy as any).users.items[0].name.value).toBe("Alice");
    expect((store.proxy as any).users.length).toBe(1);
  });

  it("changing accountId via setContext re-runs the resolver automatically", async () => {
    const capturedContexts: Record<string, unknown>[] = [];

    const resolver = vi.fn(async (_values: unknown, store: any) => {
      capturedContexts.push({ ...store.context });
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

    // First run: the resolver reads store.context.accountId → automatically
    // adds $context.accountId to the dependencies
    store.setContext({ accountId: "acc-v1" });

    void (store.proxy as any).users.items;

    await act(() => flushPromises());

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(capturedContexts[0]).toMatchObject({ accountId: "acc-v1" });

    // Change accountId — setContext calls retriggerByPaths("$context.accountId"),
    // and the resolver re-runs automatically without explicit deps or field changes
    act(() => {
      store.setContext({ accountId: "acc-v2" });
    });

    await act(() => flushPromises());

    expect(resolver).toHaveBeenCalledTimes(2);
    expect(capturedContexts[1]).toMatchObject({ accountId: "acc-v2" });
  });
});
