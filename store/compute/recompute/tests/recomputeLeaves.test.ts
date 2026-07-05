import { describe, it, expect } from "vitest";
import { recomputeLeaves } from "../recomputeLeaves";
import type { AnyConfigNode } from "../../../types";
import type { FieldState } from "../../index";

import type { ComputeEntry } from "../../../registerNodes";
import type { ValuesCache } from "../../../valuesCache";

const translate = (...args: any[]) => String(args[0]);

function makeCache(values: Record<string, unknown> = {}): ValuesCache {
  return { values, nodeSlot: new WeakMap() };
}

describe("recomputeLeaves", () => {
  it("returns an empty Set for an empty leaf list", () => {
    const result = recomputeLeaves([], new WeakMap(), makeCache(), translate);
    expect(result.size).toBe(0);
  });

  it("adds a new node (no prev state) into changed", () => {
    const node = {} as unknown as AnyConfigNode;
    const leaf: ComputeEntry = { node, path: "field" };
    const nodeState = new WeakMap<object, FieldState>();

    const result = recomputeLeaves([leaf], nodeState, makeCache(), translate);

    expect(result.has(node)).toBe(true);
    expect(nodeState.get(node)).toBeDefined();
  });

  it("does not add a node into changed when its state is unchanged", () => {
    const node = {} as unknown as AnyConfigNode;
    const leaf: ComputeEntry = { node, path: "field" };
    const nodeState = new WeakMap<object, FieldState>();
    // The state already matches what computeFieldState will return
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

  it("computed node: a computed-value change adds it into changed and updates nodeState", () => {
    const computedNode = {
      value: () => 99,
    } as unknown as AnyConfigNode;
    const leaf: ComputeEntry = { node: computedNode, path: "total" };
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

  it("preserves the submitting, dirty, revalidate flags from the prev state", () => {
    const node = {} as unknown as AnyConfigNode;
    const leaf: ComputeEntry = { node, path: "field" };
    const nodeState = new WeakMap<object, FieldState>();
    // Set isRequired=true and revalidate=true → this triggers isInvalid
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

    // Change isVisible to trigger a recompute (use a node with isVisible=false)
    const visibleNode = { isVisible: false } as unknown as AnyConfigNode;
    const visibleLeaf: ComputeEntry = { node: visibleNode, path: "hidden" };
    const visibleState: FieldState = {
      value: "",
      isVisible: true, // was true, becomes false → will change
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
