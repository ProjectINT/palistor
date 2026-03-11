/**
 * Интеграционный тест: tracking при recompute.
 *
 * Unit-тесты для каждой функции — в co-located файлах:
 *   pairKey.test.ts
 *   createGroupDeps.test.ts
 *   getRecipientGroups.test.ts
 *   getNodeGroupPath.test.ts
 *   resolveGroupByPath.test.ts
 *   createTrackingValues.test.ts
 */
import { describe, it, expect } from "vitest";
import { createTrackingValues, getRecipientGroups, pairKey } from "../groupDeps";

// ─── Интеграция: tracking при recompute ──────────────────────────────────────

describe("tracking integration", () => {
  it("обнаруживает кросс-групповую зависимость через isVisible", () => {
    // Симуляция: passport.number isVisible читает paymentType (root)
    // и записывает root→passport зависимость
    const deps = new Set([pairKey("", ""), pairKey("passport", "passport")]);
    const values = { paymentType: "bank" };

    // Эмулируем вычисление isVisible для passport.number
    const tracked = createTrackingValues(
      values as Record<string, unknown>,
      "passport",
      deps,
    );
    // isVisible: (values) => values.paymentType === "bank"
    const isVisible = tracked.paymentType === "bank";

    expect(isVisible).toBe(true);
    // root → passport зависимость должна быть записана
    expect(deps.has(pairKey("", "passport"))).toBe(true);

    // Теперь getRecipientGroups должен найти passport как реципиента root
    expect(getRecipientGroups(deps, "")).toEqual(["passport"]);
  });
});

