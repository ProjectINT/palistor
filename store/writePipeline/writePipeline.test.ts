import { describe, it, expect, vi } from "vitest";
import { Palistor } from "../store/palistor";
import type { AnyConfigNode } from "../store/types";

// ─── WritePipeline (via Palistor) ───────────────────────────────────────────

describe("WritePipeline", () => {
  it("returns null when the node is not registered", () => {
    const root: AnyConfigNode = { field: { value: "" } };
    const store = new Palistor({ config: root });
    const unregistered: AnyConfigNode = { value: "x" };

    const result = store.writePipeline.execute(unregistered, "test");

    expect(result).toBeNull();
  });

  it("runs the full cycle: format → store → recompute", () => {
    const node: AnyConfigNode = {
      value: 0,
      formatter: (v: unknown) => Number(v) || 0,
    };
    const root: AnyConfigNode = { amount: node };
    const store = new Palistor({ config: root });

    const result = store.writePipeline.execute(node, "42");

    expect(store.nodes.nodeState.get(node)!.value).toBe(42);
    expect(result!.changed.has(node)).toBe(true);
  });

  it("setter branch: patches dependent nodes AND writes the current one", () => {
    const targetNode: AnyConfigNode = { value: "old" };
    const node: AnyConfigNode = {
      value: "a",
      setter: () => ({ target: "new" }),
    };
    const root: AnyConfigNode = { source: node, target: targetNode };
    const store = new Palistor({ config: root });

    const result = store.writePipeline.execute(node, "b");

    expect(result!.changed.has(node)).toBe(true);
    expect(result!.changed.has(targetNode)).toBe(true);
    expect(store.nodes.nodeState.get(node)!.value).toBe("b");
    expect(store.nodes.nodeState.get(targetNode)!.value).toBe("new");
  });

  it("returns skipped: true when the value is unchanged", () => {
    const node: AnyConfigNode = { value: "hello" };
    const root: AnyConfigNode = { field: node };
    const store = new Palistor({ config: root });
    const recomputeSpy = vi.spyOn(store, "recompute");

    const result = store.writePipeline.execute(node, "hello");

    expect(result!.skipped).toBe(true);
    expect(result!.changed.size).toBe(0);
    expect(recomputeSpy).not.toHaveBeenCalled();
  });

  it("returns skipped when the value matches after formatting", () => {
    const node: AnyConfigNode = {
      value: 42,
      formatter: (v: unknown) => Number(v) || 0,
    };
    const root: AnyConfigNode = { amount: node };
    const store = new Palistor({ config: root });
    const recomputeSpy = vi.spyOn(store, "recompute");

    const result = store.writePipeline.execute(node, "42");

    expect(result!.skipped).toBe(true);
    expect(recomputeSpy).not.toHaveBeenCalled();
  });

  it("does not skip the write when the value differs", () => {
    const node: AnyConfigNode = { value: "hello" };
    const root: AnyConfigNode = { field: node };
    const store = new Palistor({ config: root });
    const recomputeSpy = vi.spyOn(store, "recompute");

    const result = store.writePipeline.execute(node, "world");

    expect(result!.skipped).toBeUndefined();
    expect(result!.changed.has(node)).toBe(true);
    expect(recomputeSpy).toHaveBeenCalledOnce();
  });

  it("compares NaN correctly via Object.is", () => {
    const node: AnyConfigNode = { value: NaN };
    const root: AnyConfigNode = { field: node };
    const store = new Palistor({ config: root });
    const recomputeSpy = vi.spyOn(store, "recompute");

    const result = store.writePipeline.execute(node, NaN);

    expect(result!.skipped).toBe(true);
    expect(recomputeSpy).not.toHaveBeenCalled();
  });
});
