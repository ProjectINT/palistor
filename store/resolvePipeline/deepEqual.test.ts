import { describe, it, expect } from "vitest";
import { deepEqual } from "./deepEqual";

describe("deepEqual", () => {
  it("primitives", () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual("a", "a")).toBe(true);
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(null, undefined)).toBe(false);
  });

  it("arrays by value (the regression case: distinct clones, equal content)", () => {
    expect(deepEqual(["a", "b"], ["a", "b"])).toBe(true);
    expect(deepEqual(["a"], ["a", "b"])).toBe(false);
    expect(deepEqual([{ x: 1 }], [{ x: 1 }])).toBe(true);
    expect(deepEqual([{ x: 1 }], [{ x: 2 }])).toBe(false);
  });

  it("plain objects", () => {
    expect(deepEqual({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
  });

  it("dates by timestamp", () => {
    expect(deepEqual(new Date("2020-01-01"), new Date("2020-01-01"))).toBe(true);
    expect(deepEqual(new Date("2020-01-01"), new Date("2021-01-01"))).toBe(false);
    expect(deepEqual(new Date("2020-01-01"), "2020-01-01")).toBe(false);
  });

  it("mismatched shapes", () => {
    expect(deepEqual([], {})).toBe(false);
    expect(deepEqual([1], { 0: 1 })).toBe(false);
  });
});
