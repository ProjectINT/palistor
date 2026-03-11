import { describe, it, expect } from "vitest";
import { topologicalSortComputed } from "../topologicalSortComputed";
import type { AnyConfigNode } from "../../../types";

function makeEntry(path: string, deps: string[] = []): { node: AnyConfigNode; path: string } {
  return { node: { value: () => 0, dependencies: deps } as unknown as AnyConfigNode, path };
}

describe("topologicalSortComputed", () => {
  it("возвращает пустой массив без изменений", () => {
    expect(topologicalSortComputed([])).toEqual([]);
  });

  it("возвращает массив из одного элемента без изменений", () => {
    const entry = makeEntry("a");
    expect(topologicalSortComputed([entry])).toEqual([entry]);
  });

  it("независимые узлы: порядок сохраняется", () => {
    const a = makeEntry("a");
    const b = makeEntry("b");
    const result = topologicalSortComputed([a, b]);
    expect(result).toHaveLength(2);
    expect(result).toContain(a);
    expect(result).toContain(b);
  });

  it("B зависит от A → A идёт раньше B", () => {
    const a = makeEntry("a");
    const b = makeEntry("b", ["a"]);
    const result = topologicalSortComputed([b, a]);
    expect(result.indexOf(a)).toBeLessThan(result.indexOf(b));
  });

  it("цепочка A → B → C сортируется корректно", () => {
    const a = makeEntry("a");
    const b = makeEntry("b", ["a"]);
    const c = makeEntry("c", ["b"]);
    const result = topologicalSortComputed([c, b, a]);
    expect(result.indexOf(a)).toBeLessThan(result.indexOf(b));
    expect(result.indexOf(b)).toBeLessThan(result.indexOf(c));
  });

  it("зависимость на не-computed узел игнорируется", () => {
    const a = makeEntry("a", ["external"]);
    const b = makeEntry("b");
    const result = topologicalSortComputed([a, b]);
    expect(result).toHaveLength(2);
  });

  it("циклическая зависимость: все узлы включаются в результат", () => {
    const a = makeEntry("a", ["b"]);
    const b = makeEntry("b", ["a"]);
    const result = topologicalSortComputed([a, b]);
    expect(result).toHaveLength(2);
    expect(result).toContain(a);
    expect(result).toContain(b);
  });
});
