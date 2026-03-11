import { describe, it, expect } from "vitest";
import { createTrackingValues } from "../createTrackingValues";
import { pairKey } from "../pairKey";

const baseValues = {
  paymentType: "card",
  amount: 100,
  passport: { number: "123", issueDate: "2024-01-01" },
};

describe("createTrackingValues", () => {
  it("записывает кросс-групповую зависимость при чтении leaf из другой группы", () => {
    const deps = new Set<string>();
    const tracked = createTrackingValues(baseValues, "passport", deps);
    void tracked.paymentType;
    expect(deps.has(pairKey("", "passport"))).toBe(true);
  });

  it("не записывает self-зависимость при чтении внутри своей группы", () => {
    const deps = new Set<string>();
    const tracked = createTrackingValues(baseValues, "passport", deps);
    const p = tracked.passport as Record<string, unknown>;
    void p.number;
    expect(deps.size).toBe(0);
  });

  it("записывает зависимость при чтении вложенной группы из root-реципиента", () => {
    const deps = new Set<string>();
    const tracked = createTrackingValues(baseValues, "", deps);
    const p = tracked.passport as Record<string, unknown>;
    void p.number;
    expect(deps.has(pairKey("passport", ""))).toBe(true);
  });

  it("прозрачно возвращает значения без мутации", () => {
    const deps = new Set<string>();
    const tracked = createTrackingValues(baseValues, "", deps);
    expect(tracked.paymentType).toBe("card");
    const p = tracked.passport as Record<string, unknown>;
    expect(p.number).toBe("123");
  });

  it("обрабатывает глубоко вложенные группы", () => {
    const values = { topField: "x", level1: { level2: { l2Field: "b" } } };
    const deps = new Set<string>();
    const tracked = createTrackingValues(values, "level1.level2", deps);
    void tracked.topField;
    expect(deps.has(pairKey("", "level1.level2"))).toBe(true);
  });

  it("мемоизирует суб-прокси: повторный доступ возвращает тот же объект", () => {
    const deps = new Set<string>();
    const tracked = createTrackingValues(baseValues, "", deps);
    expect(tracked.passport).toBe(tracked.passport);
  });
});
