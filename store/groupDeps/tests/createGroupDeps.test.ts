import { describe, it, expect } from "vitest";
import { createGroupDeps } from "../createGroupDeps";
import { pairKey } from "../pairKey";
import { buildNodeMaps } from "../../nodeMap";
import type { AnyConfigNode } from "../../types";

function buildMaps(root: AnyConfigNode) {
  const nodePaths = new WeakMap<object, string>();
  const nodeParents = new WeakMap<object, object>();
  buildNodeMaps(root, nodePaths, nodeParents);
  return { nodePaths };
}

describe("createGroupDeps", () => {
  it("создаёт только self-зависимость для плоского конфига", () => {
    const root = { email: { value: "" }, name: { value: "" } } as unknown as AnyConfigNode;
    const { nodePaths } = buildMaps(root);
    const deps = createGroupDeps(root, nodePaths);

    expect(deps.has(pairKey("", ""))).toBe(true);
    expect(deps.size).toBe(1);
  });

  it("создаёт self-зависимости для корня и каждой вложенной группы", () => {
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

  it("не создаёт зависимости для листьев", () => {
    const root = { field: { value: "" } } as unknown as AnyConfigNode;
    const { nodePaths } = buildMaps(root);
    const deps = createGroupDeps(root, nodePaths);

    // только root→root
    expect(deps.size).toBe(1);
  });
});
