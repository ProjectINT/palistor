import { describe, it, expect } from "vitest";
import { formatPatch } from "./formatPatch";
import type { AnyConfigNode } from "../store/types";

describe("formatPatch", () => {
  it("форматирует листовые значения через formatter", () => {
    const node: AnyConfigNode = {
      amount: {
        value: 0,
        formatter: (v: unknown) => Number(v) || 0,
      },
    };
    const result = formatPatch(node, { amount: "42" }, {});
    expect(result.amount).toBe(42);
  });

  it("значение без formatter проходит без изменений", () => {
    const node: AnyConfigNode = { name: { value: "" } };
    const result = formatPatch(node, { name: "Alice" }, {});
    expect(result.name).toBe("Alice");
  });

  it("рекурсивно обходит вложенные группы", () => {
    const node: AnyConfigNode = {
      address: {
        zip: {
          value: "",
          formatter: (v: unknown) => String(v).replace(/\D/g, ""),
        },
      },
    };
    const result = formatPatch(node, { address: { zip: "1-2-3" } }, {});
    expect((result.address as Record<string, unknown>).zip).toBe("123");
  });

  it("пропускает ключи отсутствующие в конфиге", () => {
    const node: AnyConfigNode = { name: { value: "" } };
    const result = formatPatch(node, { name: "Bob", unknown: "x" }, {});
    expect("unknown" in result).toBe(false);
    expect(result.name).toBe("Bob");
  });

  it("не мутирует исходный патч", () => {
    const node: AnyConfigNode = {
      price: { value: 0, formatter: (v: unknown) => Number(v) },
    };
    const patch = { price: "10" };
    formatPatch(node, patch, {});
    expect(patch.price).toBe("10");
  });

  it("пропускает массивы в значениях групп", () => {
    const node: AnyConfigNode = { items: { child: { value: "" } } };
    const result = formatPatch(node, { items: [1, 2, 3] as unknown as Record<string, unknown> }, {});
    expect("items" in result).toBe(false);
  });
});
