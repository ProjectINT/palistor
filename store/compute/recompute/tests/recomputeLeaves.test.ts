import { describe, it, expect } from "vitest";
import { recomputeLeaves } from "../recomputeLeaves";
import type { AnyConfigNode } from "../../../types";
import type { FieldState } from "../../index";

import type { LeafEntry } from "../../../registerNodes";
import type { ValuesCache } from "../../../valuesCache";

const translate = (...args: any[]) => String(args[0]);

function makeCache(values: Record<string, unknown> = {}): ValuesCache {
  return { values, nodeSlot: new WeakMap() };
}

describe("recomputeLeaves", () => {
  it("возвращает пустой Set для пустого списка листьев", () => {
    const result = recomputeLeaves([], new WeakMap(), makeCache(), translate);
    expect(result.size).toBe(0);
  });

  it("добавляет новый узел (без prev-состояния) в changed", () => {
    const node = {} as unknown as AnyConfigNode;
    const leaf: LeafEntry = { node, path: "field" };
    const nodeState = new WeakMap<object, FieldState>();

    const result = recomputeLeaves([leaf], nodeState, makeCache(), translate);

    expect(result.has(node)).toBe(true);
    expect(nodeState.get(node)).toBeDefined();
  });

  it("не добавляет узел в changed, если состояние не изменилось", () => {
    const node = {} as unknown as AnyConfigNode;
    const leaf: LeafEntry = { node, path: "field" };
    const nodeState = new WeakMap<object, FieldState>();
    // Состояние уже соответствует тому, что вернёт computeFieldState
    const prevState: FieldState = {
      value: "",
      isVisible: true,
      isRequired: false,
      isDisabled: false,
      isReadOnly: false,
    };
    nodeState.set(node, prevState);

    const result = recomputeLeaves([leaf], nodeState, makeCache(), translate);

    expect(result.has(node)).toBe(false);
  });

  it("computed-узел: изменение вычисленного значения добавляет в changed и обновляет nodeState", () => {
    const computedNode = {
      value: () => 99,
    } as unknown as AnyConfigNode;
    const leaf: LeafEntry = { node: computedNode, path: "total" };
    const nodeState = new WeakMap<object, FieldState>();
    const prevState: FieldState = {
      value: 42,
      isVisible: true,
      isRequired: false,
      isDisabled: false,
      isReadOnly: false,
    };
    nodeState.set(computedNode, prevState);

    const result = recomputeLeaves([leaf], nodeState, makeCache(), translate);

    expect(result.has(computedNode)).toBe(true);
    expect((nodeState.get(computedNode) as FieldState).value).toBe(99);
  });

  it("сохраняет флаги submitting, dirty, revalidate из prev-состояния", () => {
    const node = {} as unknown as AnyConfigNode;
    const leaf: LeafEntry = { node, path: "field" };
    const nodeState = new WeakMap<object, FieldState>();
    // Ставим isRequired=true и revalidate=true → это вызовет isInvalid
    const prevState: FieldState = {
      value: "",
      isVisible: true,
      isRequired: false,
      isDisabled: false,
      isReadOnly: false,
      submitting: true,
      dirty: true,
      revalidate: false,
    };
    nodeState.set(node, prevState);

    // Изменим isVisible, чтобы вызвать пересчёт (используем узел с isVisible=false)
    const visibleNode = { isVisible: false } as unknown as AnyConfigNode;
    const visibleLeaf: LeafEntry = { node: visibleNode, path: "hidden" };
    const visibleState: FieldState = {
      value: "",
      isVisible: true, // было true, станет false → изменится
      isRequired: false,
      isDisabled: false,
      isReadOnly: false,
      submitting: true,
      dirty: true,
      revalidate: true,
    };
    nodeState.set(visibleNode, visibleState);

    recomputeLeaves([visibleLeaf], nodeState, makeCache(), translate);

    const updated = nodeState.get(visibleNode) as FieldState;
    expect(updated.submitting).toBe(true);
    expect(updated.dirty).toBe(true);
    expect(updated.revalidate).toBe(true);
  });
});
