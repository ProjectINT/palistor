/**
 * Contract replacement for store/writePipeline/writePipeline.test.ts, which
 * drives `store.writePipeline.execute()` and reads `store.nodes.nodeState`
 * (mechanism). The same rules through the public surface: a write whose
 * formatted value equals the current one (Object.is) is skipped — no
 * notification — and a real write notifies once and patches setter targets.
 */
import { describe, it, expect, vi } from "vitest";
import { Palistor } from "@impl";

describe("write pipeline (public surface)", () => {
  it("format → store: the formatted value lands in the field", () => {
    const store = new Palistor({ config: { amount: { value: 0, formatter: (v: unknown) => Number(v) || 0 } } });
    store.proxy.amount.value = "42" as any;
    expect(store.proxy.amount.value).toBe(42);
  });

  it("setter branch: writes the field AND patches its sibling, one notification", () => {
    const store = new Palistor({
      config: { source: { value: "a", setter: () => ({ target: "new" }) }, target: { value: "old" } },
    });
    const listener = vi.fn();
    store.subscribeGlobal(listener);

    store.proxy.source.value = "b";

    expect(store.proxy.source.value).toBe("b");
    expect(store.proxy.target.value).toBe("new");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["the same value", { value: "hello" }, "hello"],
    ["a value equal after formatting", { value: 42, formatter: (v: unknown) => Number(v) || 0 }, "42"],
    ["NaN over NaN (Object.is)", { value: NaN }, NaN],
  ])("skips %s: no notification, no version change", (_name, field, written) => {
    const store = new Palistor({ config: { field } as any });
    const listener = vi.fn();
    store.subscribeGlobal(listener);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const v0 = store.getVersion();

    (store.proxy as any).field.value = written;

    expect(listener).not.toHaveBeenCalled();
    expect(store.getVersion()).toBe(v0);
    warn.mockRestore();
  });

  it("does not skip a different value", () => {
    const store = new Palistor({ config: { field: { value: "hello" } } });
    const listener = vi.fn();
    store.subscribeGlobal(listener);

    store.proxy.field.value = "world";

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.proxy.field.value).toBe("world");
  });
});
