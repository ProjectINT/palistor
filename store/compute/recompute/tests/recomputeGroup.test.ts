import { describe, it, expect } from "vitest";
import { recomputeGroup } from "../recomputeGroup";
import type { AnyConfigNode } from "../../../types";
import type { FieldState } from "../../index";
import type { GroupLeafMap } from "../../../registerNodes";
import type { ValuesCache } from "../../../valuesCache";

const translate = (...args: any[]) => String(args[0]);

function makeCache(values: Record<string, unknown> = {}): ValuesCache {
  return { values, nodeSlot: new WeakMap() };
}

describe("recomputeGroup", () => {
  it("возвращает пустой Set, если у группы нет листьев в карте", () => {
    const root = {} as AnyConfigNode;
    const groupLeafMap: GroupLeafMap = new WeakMap();
    const result = recomputeGroup(root, groupLeafMap, new WeakMap(), makeCache(), translate);
    expect(result.size).toBe(0);
  });

  it("пересчитывает прямые листья группы и возвращает changed", () => {
    const fieldNode = {} as unknown as AnyConfigNode;
    const root = { field: fieldNode } as unknown as AnyConfigNode;
    const groupLeafMap: GroupLeafMap = new WeakMap([
      [root, [{ node: fieldNode, path: "field" }]],
    ]);
    const nodeState = new WeakMap<object, FieldState>();

    const result = recomputeGroup(root, groupLeafMap, nodeState, makeCache(), translate);

    // fieldNode не имел предыдущего состояния → должен быть в changed
    expect(result.has(fieldNode)).toBe(true);
  });

  it("рекурсивно собирает листья дочерних групп", () => {
    const childField = {} as unknown as AnyConfigNode;
    const childGroup = { x: childField } as unknown as AnyConfigNode;
    const root = { child: childGroup } as unknown as AnyConfigNode;

    const groupLeafMap: GroupLeafMap = new WeakMap([
      [root, []],
      [childGroup, [{ node: childField, path: "child.x" }]],
    ]);
    const nodeState = new WeakMap<object, FieldState>();

    const result = recomputeGroup(root, groupLeafMap, nodeState, makeCache(), translate);

    expect(result.has(childField)).toBe(true);
  });
});
