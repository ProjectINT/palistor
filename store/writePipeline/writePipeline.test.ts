import { describe, it, expect, vi } from "vitest";
import { Palistor } from "../store/palistor";
import type { AnyConfigNode } from "../store/types";

// ─── WritePipeline (через Palistor) ─────────────────────────────────────────

describe("WritePipeline", () => {
  it("возвращает null если узел не зарегистрирован", () => {
    const root: AnyConfigNode = { field: { value: "" } };
    const store = new Palistor({ config: root });
    const unregistered: AnyConfigNode = { value: "x" };

    const result = store.writePipeline.execute(unregistered, "test");

    expect(result).toBeNull();
  });

  it("выполняет полный цикл: format → store → recompute", () => {
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

  it("setter-ветка: патчит зависимые узлы И записывает текущий", () => {
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

  it("возвращает skipped: true если значение не изменилось", () => {
    const node: AnyConfigNode = { value: "hello" };
    const root: AnyConfigNode = { field: node };
    const store = new Palistor({ config: root });
    const recomputeSpy = vi.spyOn(store, "recompute");

    const result = store.writePipeline.execute(node, "hello");

    expect(result!.skipped).toBe(true);
    expect(result!.changed.size).toBe(0);
    expect(recomputeSpy).not.toHaveBeenCalled();
  });

  it("возвращает skipped если значение совпадает после форматирования", () => {
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

  it("не пропускает запись если значение отличается", () => {
    const node: AnyConfigNode = { value: "hello" };
    const root: AnyConfigNode = { field: node };
    const store = new Palistor({ config: root });
    const recomputeSpy = vi.spyOn(store, "recompute");

    const result = store.writePipeline.execute(node, "world");

    expect(result!.skipped).toBeUndefined();
    expect(result!.changed.has(node)).toBe(true);
    expect(recomputeSpy).toHaveBeenCalledOnce();
  });

  it("корректно сравнивает NaN через Object.is", () => {
    const node: AnyConfigNode = { value: NaN };
    const root: AnyConfigNode = { field: node };
    const store = new Palistor({ config: root });
    const recomputeSpy = vi.spyOn(store, "recompute");

    const result = store.writePipeline.execute(node, NaN);

    expect(result!.skipped).toBe(true);
    expect(recomputeSpy).not.toHaveBeenCalled();
  });
});
