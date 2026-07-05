/**
 * Integration test: tracking during recompute.
 *
 * Unit tests for each function live in co-located files:
 *   pairKey.test.ts
 *   createGroupDeps.test.ts
 *   getRecipientGroups.test.ts
 *   getNodeGroupPath.test.ts
 *   resolveGroupByPath.test.ts
 *   createTrackingValues.test.ts
 */
import { describe, it, expect } from "vitest";
import { createTrackingValues, getRecipientGroups, pairKey } from "../groupDeps";

// ─── Integration: tracking during recompute───────────────────────────────────

describe("tracking integration", () => {
  it("detects a cross-group dependency via isVisible", () => {
    // Simulation: passport.number's isVisible reads paymentType (root)
    // and records the root→passport dependency
    const deps = new Set([pairKey("", ""), pairKey("passport", "passport")]);
    const values = { paymentType: "bank" };

    // Emulate the isVisible computation for passport.number
    const tracked = createTrackingValues(
      values as Record<string, unknown>,
      "passport",
      deps,
    );
    // isVisible: (values) => values.paymentType === "bank"
    const isVisible = tracked.paymentType === "bank";

    expect(isVisible).toBe(true);
    // the root → passport dependency must be recorded
    expect(deps.has(pairKey("", "passport"))).toBe(true);

    // Now getRecipientGroups must find passport as root's recipient
    expect(getRecipientGroups(deps, "")).toEqual(["passport"]);
  });
});

