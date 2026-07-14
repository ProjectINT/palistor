import { describe, it, expect } from "vitest";
import { collectGroupComputeNodes } from "../collectGroupComputeNodes";
import type { AnyConfigNode } from "../../../types";
import type { GroupComputeMap } from "../../../registerNodes";

function makeLeaf(path: string): { node: AnyConfigNode; path: string } {
  return { node: { value: "" } as unknown as AnyConfigNode, path };
}

describe("collectGroupComputeNodes", () => {
  it("returns an empty array for a group with no leaves in the map", () => {
    const group = {} as AnyConfigNode;
    const map: GroupComputeMap = new WeakMap();
    expect(collectGroupComputeNodes(group, map)).toEqual([]);
  });

  it("returns the group's direct leaves", () => {
    const group = {} as AnyConfigNode;
    const leaf = makeLeaf("a");
    const map: GroupComputeMap = new WeakMap([[group, [leaf]]]);
    expect(collectGroupComputeNodes(group, map)).toEqual([leaf]);
  });

  it("recursively collects leaves of child groups", () => {
    const childGroup = {} as AnyConfigNode;
    const childLeaf = makeLeaf("child.x");
    const childMap: GroupComputeMap = new WeakMap([[childGroup, [childLeaf]]]);

    // The parent group contains a child group (no value)
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

  it("skips child nodes with 'value' (leaf fields)", () => {
    const leafNode = { value: "x" } as unknown as AnyConfigNode;
    const root = { field: leafNode } as unknown as AnyConfigNode;
    const map: GroupComputeMap = new WeakMap([[root, []]]);

    // Must not recurse into leafNode
    const result = collectGroupComputeNodes(root, map);
    expect(result).toEqual([]);
  });

  it("skips ListNodes — a template is not a compute target", () => {
    // registerNodes stamps __kind="group" on the array itself (hasChildren sees
    // the numeric keys), so without an explicit Array.isArray guard the walk
    // descends into the template and pulls its leaves into the recompute — where
    // they would be evaluated against the ROOT values object.
    const template = {} as AnyConfigNode;
    const templateLeaf = makeLeaf("users.name");
    const list = [template] as unknown as AnyConfigNode;
    (list as unknown as { __kind: string }).__kind = "group";

    const root = { users: list } as unknown as AnyConfigNode;
    const map: GroupComputeMap = new WeakMap([
      [root, []],
      [template, [templateLeaf]],
    ]);

    expect(collectGroupComputeNodes(root, map)).toEqual([]);
  });
});
