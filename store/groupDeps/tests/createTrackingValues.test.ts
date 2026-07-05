import { describe, it, expect } from "vitest";
import { createTrackingValues } from "../createTrackingValues";
import { pairKey } from "../pairKey";

const baseValues = {
  paymentType: "card",
  amount: 100,
  passport: { number: "123", issueDate: "2024-01-01" },
};

describe("createTrackingValues", () => {
  it("records a cross-group dependency when a leaf of another group is read", () => {
    const deps = new Set<string>();
    const tracked = createTrackingValues(baseValues, "passport", deps);
    void tracked.paymentType;
    expect(deps.has(pairKey("", "passport"))).toBe(true);
  });

  it("records no self-dependency for a read within its own group", () => {
    const deps = new Set<string>();
    const tracked = createTrackingValues(baseValues, "passport", deps);
    const p = tracked.passport as Record<string, unknown>;
    void p.number;
    expect(deps.size).toBe(0);
  });

  it("records a dependency when a nested group is read from a root recipient", () => {
    const deps = new Set<string>();
    const tracked = createTrackingValues(baseValues, "", deps);
    const p = tracked.passport as Record<string, unknown>;
    void p.number;
    expect(deps.has(pairKey("passport", ""))).toBe(true);
  });

  it("returns values transparently without mutation", () => {
    const deps = new Set<string>();
    const tracked = createTrackingValues(baseValues, "", deps);
    expect(tracked.paymentType).toBe("card");
    const p = tracked.passport as Record<string, unknown>;
    expect(p.number).toBe("123");
  });

  it("handles deeply nested groups", () => {
    const values = { topField: "x", level1: { level2: { l2Field: "b" } } };
    const deps = new Set<string>();
    const tracked = createTrackingValues(values, "level1.level2", deps);
    void tracked.topField;
    expect(deps.has(pairKey("", "level1.level2"))).toBe(true);
  });

  it("memoizes sub-proxies: repeated access returns the same object", () => {
    const deps = new Set<string>();
    const tracked = createTrackingValues(baseValues, "", deps);
    expect(tracked.passport).toBe(tracked.passport);
  });
});
