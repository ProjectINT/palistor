import { describe, it, expect } from "vitest";
import { getNodeGroupPath } from "../getNodeGroupPath";
import { buildNodeMaps } from "../../nodeMap";
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
  it("возвращает '' для листа в корневой группе", () => {
    const { nodePaths, nodeParents } = buildMaps(root);
    expect(getNodeGroupPath(root.paymentType as object, nodeParents, nodePaths)).toBe("");
  });

  it("возвращает путь родительской группы для листа вложенной группы", () => {
    const { nodePaths, nodeParents } = buildMaps(root);
    const passport = root.passport as AnyConfigNode;
    expect(getNodeGroupPath(passport.number as object, nodeParents, nodePaths)).toBe("passport");
  });

  it("возвращает '' для самого rootConfig (группа без пути)", () => {
    const { nodePaths, nodeParents } = buildMaps(root);
    expect(getNodeGroupPath(root, nodeParents, nodePaths)).toBe("");
  });

  it("возвращает собственный путь для группового узла", () => {
    const { nodePaths, nodeParents } = buildMaps(root);
    expect(getNodeGroupPath(root.passport as object, nodeParents, nodePaths)).toBe("passport");
  });
});
