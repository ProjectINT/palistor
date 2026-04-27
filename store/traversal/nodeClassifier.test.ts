import { describe, it, expect } from "vitest";
import { isLeafNode, isGroupNode, hasChildren, isListNode, configKeys } from "./nodeClassifier";

/** Helper: tag a node with __kind as registerNodes would */
function asLeaf<T extends object>(node: T): T {
  (node as any).__kind = "leaf";
  return node;
}
function asGroup<T extends object>(node: T): T {
  (node as any).__kind = "group";
  return node;
}

describe("isLeafNode", () => {
  it("returns true for leaf node tagged with __kind", () => {
    expect(isLeafNode(asLeaf({ value: "x" }))).toBe(true);
  });

  it("returns true for leaf with extra CONFIG_PROPS", () => {
    expect(isLeafNode(asLeaf({ value: "", label: "Name" }))).toBe(true);
  });

  it("returns false for untagged node", () => {
    expect(isLeafNode({})).toBe(false);
  });

  it("returns false for group node", () => {
    expect(isLeafNode(asGroup({ city: { value: "" } }))).toBe(false);
  });
});

describe("isGroupNode", () => {
  it("returns true for group node tagged with __kind", () => {
    expect(isGroupNode(asGroup({ city: { value: "" } }))).toBe(true);
  });

  it("returns false for leaf node", () => {
    expect(isGroupNode(asLeaf({ value: "x" }))).toBe(false);
  });

  it("returns true for untagged node without value (fallback)", () => {
    expect(isGroupNode({})).toBe(true);
  });
});

describe("hasChildren", () => {
  it("returns true for group-like node (has child objects)", () => {
    expect(hasChildren({ city: { value: "" } })).toBe(true);
  });

  it("returns false for leaf node (value is CONFIG_PROP, no child objects)", () => {
    expect(hasChildren({ value: "x" })).toBe(false);
  });

  it("returns false for empty object", () => {
    expect(hasChildren({})).toBe(false);
  });
});

describe("isListNode", () => {
  it("returns true for empty array", () => {
    expect(isListNode([])).toBe(true);
  });

  it("returns true for populated array", () => {
    expect(isListNode([1, 2, 3])).toBe(true);
  });

  it("returns false for plain object", () => {
    expect(isListNode({})).toBe(false);
  });

  it("returns false for null", () => {
    expect(isListNode(null)).toBe(false);
  });
});

describe("configKeys", () => {
  it("filters out all CONFIG_PROPS, keeps user keys", () => {
    const node = {
      value: "",
      label: "Name",
      validate: () => undefined,
      city: { value: "" },
      street: { value: "" },
    } as Record<string, unknown>;
    expect(configKeys(node)).toEqual(["city", "street"]);
  });

  it("returns all keys when no CONFIG_PROPS present", () => {
    const node = { a: 1, b: 2 } as Record<string, unknown>;
    expect(configKeys(node)).toEqual(["a", "b"]);
  });

  it("returns empty array for node with only CONFIG_PROPS keys", () => {
    const node = { value: "", label: "x", validate: () => null } as Record<string, unknown>;
    expect(configKeys(node)).toEqual([]);
  });

  it("filters out __kind", () => {
    const node = { __kind: "leaf", name: { value: "" } } as Record<string, unknown>;
    expect(configKeys(node)).toEqual(["name"]);
  });
});

describe("isListNode", () => {
  it("returns true for empty array", () => {
    expect(isListNode([])).toBe(true);
  });

  it("returns true for populated array", () => {
    expect(isListNode([1, 2, 3])).toBe(true);
  });

  it("returns false for plain object", () => {
    expect(isListNode({})).toBe(false);
  });

  it("returns false for null", () => {
    expect(isListNode(null)).toBe(false);
  });
});

describe("configKeys", () => {
  it("filters out all CONFIG_PROPS, keeps user keys", () => {
    const node = {
      value: "",
      label: "Name",
      validate: () => undefined,
      city: { value: "" },
      street: { value: "" },
    } as Record<string, unknown>;
    expect(configKeys(node)).toEqual(["city", "street"]);
  });

  it("returns all keys when no CONFIG_PROPS present", () => {
    const node = { a: 1, b: 2 } as Record<string, unknown>;
    expect(configKeys(node)).toEqual(["a", "b"]);
  });

  it("returns empty array for node with only CONFIG_PROPS keys", () => {
    const node = { value: "", label: "x", validate: () => null } as Record<string, unknown>;
    expect(configKeys(node)).toEqual([]);
  });
});
