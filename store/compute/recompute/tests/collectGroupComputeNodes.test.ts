import { describe, it, expect } from "vitest";
import { collectGroupComputeNodes } from "../collectGroupComputeNodes";
import type { AnyConfigNode } from "../../../types";
import type { GroupComputeMap } from "../../../registerNodes";

function makeLeaf(path: string): { node: AnyConfigNode; path: string } {
  return { node: { value: "" } as unknown as AnyConfigNode, path };
}

describe("collectGroupComputeNodes", () => {
  it("возвращает пустой массив для группы без листьев в карте", () => {
    const group = {} as AnyConfigNode;
    const map: GroupComputeMap = new WeakMap();
    expect(collectGroupComputeNodes(group, map)).toEqual([]);
  });

  it("возвращает прямые листья группы", () => {
    const group = {} as AnyConfigNode;
    const leaf = makeLeaf("a");
    const map: GroupComputeMap = new WeakMap([[group, [leaf]]]);
    expect(collectGroupComputeNodes(group, map)).toEqual([leaf]);
  });

  it("рекурсивно собирает листья дочерних групп", () => {
    const childGroup = {} as AnyConfigNode;
    const childLeaf = makeLeaf("child.x");
    const childMap: GroupComputeMap = new WeakMap([[childGroup, [childLeaf]]]);

    // Родительская группа содержит дочернюю группу (без value)
    const root = { child: childGroup } as unknown as AnyConfigNode;
    const rootLeaf = makeLeaf("root.y");
    const map: GroupComputeMap = new WeakMap([
      [root, [rootLeaf]],
      [childGroup, [childLeaf]],
    ]);

    const result = collectGroupComputeNodes(root, map);
    expect(result).toContain(rootLeaf);
    expect(result).toContain(childLeaf);
  });

  it("пропускает дочерние узлы с 'value' (листовые поля)", () => {
    const leafNode = { value: "x" } as unknown as AnyConfigNode;
    const root = { field: leafNode } as unknown as AnyConfigNode;
    const map: GroupComputeMap = new WeakMap([[root, []]]);

    // Не должен рекурсироваться в leafNode
    const result = collectGroupComputeNodes(root, map);
    expect(result).toEqual([]);
  });
});
