import { describe, it, expect } from "vitest";
import { createGroupDeps } from "../createGroupDeps";
import { pairKey } from "../pairKey";
import { buildNodeMaps } from "../../store/nodeMap";
import type { AnyConfigNode } from "../../types";

function buildMaps(root: AnyConfigNode) {
  const nodePaths = new WeakMap<object, string>();
  const nodeParents = new WeakMap<object, object>();
  buildNodeMaps(root, nodePaths, nodeParents);
  return { nodePaths };
}

describe("createGroupDeps", () => {
  it("creates only the self-dependency for a flat config", () => {
    const root = { email: { value: "" }, name: { value: "" } } as unknown as AnyConfigNode;
    const { nodePaths } = buildMaps(root);
    const deps = createGroupDeps(root, nodePaths);

    expect(deps.has(pairKey("", ""))).toBe(true);
    expect(deps.size).toBe(1);
  });

  it("creates self-dependencies for the root and every nested group", () => {
    const root = {
      paymentType: { value: "card" },
      passport: { number: { value: "" } },
      address: { city: { value: "" } },
    } as unknown as AnyConfigNode;
    const { nodePaths } = buildMaps(root);
    const deps = createGroupDeps(root, nodePaths);

    expect(deps.has(pairKey("", ""))).toBe(true);
    expect(deps.has(pairKey("passport", "passport"))).toBe(true);
    expect(deps.has(pairKey("address", "address"))).toBe(true);
    expect(deps.size).toBe(3);
  });

  it("creates no dependencies for leaves", () => {
    const root = { field: { value: "" } } as unknown as AnyConfigNode;
    const { nodePaths } = buildMaps(root);
    const deps = createGroupDeps(root, nodePaths);

    // root→root only
    expect(deps.size).toBe(1);
  });
});
