import { describe, it, expect } from "vitest";
import { resolveGroupByPath } from "../resolveGroupByPath";
import type { AnyConfigNode } from "../../types";

const root = {
  passport: {
    number: { value: "" },
  },
  address: {
    city: { value: "" },
  },
} as unknown as AnyConfigNode;

describe("resolveGroupByPath", () => {
  it("'' → rootConfig", () => {
    expect(resolveGroupByPath(root, "")).toBe(root);
  });

  it("a single-level path → a nested group", () => {
    expect(resolveGroupByPath(root, "passport")).toBe(root.passport);
  });

  it("a multi-level dot-path", () => {
    const deep = {
      level1: { level2: { value: "" } },
    } as unknown as AnyConfigNode;
    expect(resolveGroupByPath(deep, "level1.level2")).toBe(
      (deep.level1 as AnyConfigNode).level2,
    );
  });
});
