import { describe, it, expect } from "vitest";
import { mergeChanged } from "./mergeChanged";

describe("mergeChanged", () => {
  it("always includes the current node", () => {
    const node = {};
    const result = mergeChanged(node, new Set(), new Set());
    expect(result.has(node)).toBe(true);
    expect(result.size).toBe(1);
  });

  it("merges patched and recomputed nodes", () => {
    const node = {};
    const p1 = {};
    const p2 = {};
    const r1 = {};

    const result = mergeChanged(node, new Set([p1, p2]), new Set([r1]));

    expect(result.size).toBe(4);
    expect(result.has(p1) && result.has(p2) && result.has(r1)).toBe(true);
  });

  it("deduplicates overlapping nodes", () => {
    const node = {};
    const shared = {};
    const result = mergeChanged(node, new Set([shared]), new Set([shared, node]));
    expect(result.size).toBe(2);
  });
});
