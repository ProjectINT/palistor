import { describe, it, expect } from "vitest";
import { getNodeGroupPath } from "../getNodeGroupPath";
import { buildNodeMaps } from "../../store/nodeMap";
import type { AnyConfigNode } from "../../types";

function buildMaps(root: AnyConfigNode) {
  const nodePaths = new WeakMap<object, string>();
  const nodeParents = new WeakMap<object, object>();
  buildNodeMaps(root, nodePaths, nodeParents);
  return { nodePaths, nodeParents };
}

const root = {
  paymentType: { value: "card" },
  passport: { number: { value: "" } },
} as unknown as AnyConfigNode;

describe("getNodeGroupPath", () => {
  it("returns '' for a leaf in the root group", () => {
    const { nodePaths, nodeParents } = buildMaps(root);
    expect(getNodeGroupPath(root.paymentType as object, nodeParents, nodePaths)).toBe("");
  });

  it("returns the parent group's path for a nested group's leaf", () => {
    const { nodePaths, nodeParents } = buildMaps(root);
    const passport = root.passport as AnyConfigNode;
    expect(getNodeGroupPath(passport.number as object, nodeParents, nodePaths)).toBe("passport");
  });

  it("returns '' for the rootConfig itself (a group without a path)", () => {
    const { nodePaths, nodeParents } = buildMaps(root);
    expect(getNodeGroupPath(root, nodeParents, nodePaths)).toBe("");
  });

  it("returns the group node's own path", () => {
    const { nodePaths, nodeParents } = buildMaps(root);
    expect(getNodeGroupPath(root.passport as object, nodeParents, nodePaths)).toBe("passport");
  });
});
