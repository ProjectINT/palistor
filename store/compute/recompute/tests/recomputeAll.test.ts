import { describe, it, expect } from "vitest";
import { recomputeAll } from "../recomputeAll";
import type { AnyConfigNode } from "../../../types";
import type { FieldState } from "../../index";
import type { GroupLeafMap } from "../../../registerNodes";
import type { ValuesCache } from "../../../valuesCache";

const translate = (...args: any[]) => String(args[0]);

function makeCache(values: Record<string, unknown> = {}): ValuesCache {
  return { values, nodeSlot: new WeakMap() };
}

describe("recomputeAll", () => {
  it("возвращает пустой Set, если нет листьев", () => {
    const root = {} as AnyConfigNode;
    const groupLeafMap: GroupLeafMap = new WeakMap();
    const result = recomputeAll(root, groupLeafMap, new WeakMap(), makeCache(), translate);
    expect(result.size).toBe(0);
  });

  it("пересчитывает все листья начиная с rootConfig", () => {
    const fieldA = {} as unknown as AnyConfigNode;
    const fieldB = {} as unknown as AnyConfigNode;
    const root = { a: fieldA, b: fieldB } as unknown as AnyConfigNode;
    const groupLeafMap: GroupLeafMap = new WeakMap([
      [root, [
        { node: fieldA, path: "a" },
        { node: fieldB, path: "b" },
      ]],
    ]);
    const nodeState = new WeakMap<object, FieldState>();

    const result = recomputeAll(root, groupLeafMap, nodeState, makeCache(), translate);

    expect(result.has(fieldA)).toBe(true);
    expect(result.has(fieldB)).toBe(true);
  });

  it("не включает узлы с неизменённым состоянием", () => {
    const fieldNode = {} as unknown as AnyConfigNode;
    const root = { field: fieldNode } as unknown as AnyConfigNode;
    const groupLeafMap: GroupLeafMap = new WeakMap([
      [root, [{ node: fieldNode, path: "field" }]],
    ]);
    const nodeState = new WeakMap<object, FieldState>();
    // Состояние уже соответствует результату computeFieldState
    nodeState.set(fieldNode, {
      value: "",
      isVisible: true,
      isRequired: false,
      isDisabled: false,
      isReadOnly: false,
    });

    const result = recomputeAll(root, groupLeafMap, nodeState, makeCache(), translate);

    expect(result.has(fieldNode)).toBe(false);
  });
});
