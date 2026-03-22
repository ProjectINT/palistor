import { describe, it, expect } from "vitest";
import { isLeaf, isGroup, isListNode, configKeys } from "./nodeClassifier";

describe("isLeaf", () => {
  it("returns true for { value: 'x' }", () => {
    expect(isLeaf({ value: "x" })).toBe(true);
  });

  it("returns true for { value: '', label: 'Name' }", () => {
    expect(isLeaf({ value: "", label: "Name" })).toBe(true);
  });

  it("returns false for empty object", () => {
    expect(isLeaf({})).toBe(false);
  });

  it("returns false for group node { city: { value: '' } }", () => {
    expect(isLeaf({ city: { value: "" } })).toBe(false);
  });
});

describe("isGroup", () => {
  it("returns true for { city: { value: '' } }", () => {
    expect(isGroup({ city: { value: "" } })).toBe(true);
  });

  it("returns false for leaf { value: 'x' }", () => {
    expect(isGroup({ value: "x" })).toBe(false);
  });

  it("returns false for array", () => {
    expect(isGroup([] as unknown as object)).toBe(false);
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
