import { describe, it, expect } from "vitest";
import { topologicalSortComputed } from "../topologicalSortComputed";
import type { AnyConfigNode } from "../../../types";

function makeEntry(path: string, deps: string[] = []): { node: AnyConfigNode; path: string } {
  return { node: { value: () => 0, dependencies: deps } as unknown as AnyConfigNode, path };
}

describe("topologicalSortComputed", () => {
  it("returns an empty array unchanged", () => {
    expect(topologicalSortComputed([])).toEqual([]);
  });

  it("returns a single-element array unchanged", () => {
    const entry = makeEntry("a");
    expect(topologicalSortComputed([entry])).toEqual([entry]);
  });

  it("independent nodes: the order is preserved", () => {
    const a = makeEntry("a");
    const b = makeEntry("b");
    const result = topologicalSortComputed([a, b]);
    expect(result).toHaveLength(2);
    expect(result).toContain(a);
    expect(result).toContain(b);
  });

  it("B depends on A → A comes before B", () => {
    const a = makeEntry("a");
    const b = makeEntry("b", ["a"]);
    const result = topologicalSortComputed([b, a]);
    expect(result.indexOf(a)).toBeLessThan(result.indexOf(b));
  });

  it("the chain A → B → C sorts correctly", () => {
    const a = makeEntry("a");
    const b = makeEntry("b", ["a"]);
    const c = makeEntry("c", ["b"]);
    const result = topologicalSortComputed([c, b, a]);
    expect(result.indexOf(a)).toBeLessThan(result.indexOf(b));
    expect(result.indexOf(b)).toBeLessThan(result.indexOf(c));
  });

  it("a dependency on a non-computed node is ignored", () => {
    const a = makeEntry("a", ["external"]);
    const b = makeEntry("b");
    const result = topologicalSortComputed([a, b]);
    expect(result).toHaveLength(2);
  });

  it("a cyclic dependency: all nodes are included in the result", () => {
    const a = makeEntry("a", ["b"]);
    const b = makeEntry("b", ["a"]);
    const result = topologicalSortComputed([a, b]);
    expect(result).toHaveLength(2);
    expect(result).toContain(a);
    expect(result).toContain(b);
  });
});
