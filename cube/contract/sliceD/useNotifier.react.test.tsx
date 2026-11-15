/**
 * useNotifier: the notifier registered from a layout is what resolver onError
 * reaches as ctx.notify; switching it routes errors to the new one; after
 * unmount ctx.notify is a no-op. New in the contract (Phase 2.2): store
 * covered setNotifier only at the store level.
 */
import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Palistor, useNotifier } from "@impl";

const flushPromises = () => new Promise<void>((r) => setTimeout(r, 0));

/** A root resolve that always fails and reports through ctx.notify; re-runs when `filter` changes. */
function makeStore() {
  const resolver = vi.fn(async () => { throw new Error("load failed"); });
  const config = {
    filter: { value: "" },
    email: { value: "" },
    resolve: {
      resolver,
      deps: ["filter"],
      onError: (error: unknown, ctx: { notify: (...args: any[]) => void }) => ctx.notify(error, "LOAD_FAILED"),
    },
  };
  const store = new Palistor({ config: config as any });
  return { store, resolver };
}

async function trigger(store: any, filter: string) {
  await act(async () => {
    store.proxy.filter.value = filter;
    await flushPromises();
  });
}

describe("useNotifier", () => {
  it("resolver onError reaches the registered notifier through ctx.notify", async () => {
    const { store, resolver } = makeStore();
    const notify = vi.fn();
    renderHook(() => useNotifier(store as any, notify));

    await trigger(store, "a");

    expect(resolver).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ message: "load failed" }), "LOAD_FAILED");
  });

  it("without a notifier ctx.notify is a no-op (onError does not throw into the store)", async () => {
    const { store, resolver } = makeStore();
    await trigger(store, "a");
    expect(resolver).toHaveBeenCalled();
    expect((store.proxy as any).loading).toBe(false);
  });

  it("switching the notifier routes the next error to the new one", async () => {
    const { store } = makeStore();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ fn }) => useNotifier(store as any, fn), { initialProps: { fn: first } });

    await trigger(store, "a");
    expect(first).toHaveBeenCalledTimes(1);

    rerender({ fn: second });
    await trigger(store, "b");
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("after the host unmounts ctx.notify no longer reaches it", async () => {
    const { store, resolver } = makeStore();
    const notify = vi.fn();
    const host = renderHook(() => useNotifier(store as any, notify));

    await trigger(store, "a");
    expect(notify).toHaveBeenCalledTimes(1);

    host.unmount();
    await trigger(store, "b");
    expect(resolver.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
