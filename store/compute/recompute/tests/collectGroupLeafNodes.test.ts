import { describe, it, expect } from "vitest";
import { collectGroupLeafNodes } from "../collectGroupLeafNodes";
import type { AnyConfigNode } from "../../../types";
import type { GroupLeafMap } from "../../../registerNodes";

function makeLeaf(path: string): { node: AnyConfigNode; path: string } {
  return { node: { value: "" } as unknown as AnyConfigNode, path };
}

describe("collectGroupLeafNodes", () => {
  it("возвращает пустой массив для группы без листьев в карте", () => {
    const group = {} as AnyConfigNode;
    const map: GroupLeafMap = new WeakMap();
    expect(collectGroupLeafNodes(group, map)).toEqual([]);
  });

  it("возвращает прямые листья группы", () => {
    const group = {} as AnyConfigNode;
    const leaf = makeLeaf("a");
    const map: GroupLeafMap = new WeakMap([[group, [leaf]]]);
    expect(collectGroupLeafNodes(group, map)).toEqual([leaf]);
  });

  it("рекурсивно собирает листья дочерних групп", () => {
    const childGroup = {} as AnyConfigNode;
    const childLeaf = makeLeaf("child.x");
    const childMap: GroupLeafMap = new WeakMap([[childGroup, [childLeaf]]]);

    // Родительская группа содержит дочернюю группу (без value)
    const root = { child: childGroup } as unknown as AnyConfigNode;
    const rootLeaf = makeLeaf("root.y");
    const map: GroupLeafMap = new WeakMap([
      [root, [rootLeaf]],
      [childGroup, [childLeaf]],
    ]);

    const result = collectGroupLeafNodes(root, map);
    expect(result).toContain(rootLeaf);
    expect(result).toContain(childLeaf);
  });

  it("пропускает дочерние узлы с 'value' (листовые поля)", () => {
    const leafNode = { value: "x" } as unknown as AnyConfigNode;
    const root = { field: leafNode } as unknown as AnyConfigNode;
    const map: GroupLeafMap = new WeakMap([[root, []]]);

    // Не должен рекурсироваться в leafNode
    const result = collectGroupLeafNodes(root, map);
    expect(result).toEqual([]);
  });
});
