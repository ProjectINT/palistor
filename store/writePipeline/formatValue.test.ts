import { describe, it, expect } from "vitest";
import { formatValue } from "./formatValue";
import type { AnyConfigNode } from "../store/types";

describe("formatValue", () => {
  it("returns the value as-is without a formatter", () => {
    const node: AnyConfigNode = { value: "" };
    expect(formatValue("hello", node, {})).toBe("hello");
  });

  it("applies the formatter to the value", () => {
    const node: AnyConfigNode = {
      value: 0,
      formatter: (v: unknown) => (typeof v === "string" ? Number(v) || 0 : v),
    };
    expect(formatValue("42", node, {})).toBe(42);
  });

  it("passes allValues into the formatter", () => {
    const node: AnyConfigNode = {
      value: 0,
      formatter: (_v: unknown, vals: Record<string, unknown>) => vals.multiplier,
    };
    expect(formatValue("5", node, { multiplier: 99 })).toBe(99);
  });

  it("does not crash when the formatter returns undefined", () => {
    const node: AnyConfigNode = { value: "", formatter: () => undefined };
    expect(() => formatValue("x", node, {})).not.toThrow();
  });
});
