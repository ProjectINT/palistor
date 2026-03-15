import { describe, it, expect } from "vitest";
import { GroupDepsMap } from "./groupDepsMap";
import { buildNodeMaps } from "./nodeMap";
import { pairKey } from "../groupDeps/pairKey";
import type { AnyConfigNode } from "./types";

// ─── Тестовые конфиги ─────────────────────────────────────────────────────────

function buildMaps(root: AnyConfigNode) {
  const nodePaths = new WeakMap<object, string>();
  const nodeParents = new WeakMap<object, object>();
  buildNodeMaps(root, nodePaths, nodeParents);
  return { nodePaths, nodeParents };
}

const flat = {
  email: { value: "" },
  name: { value: "" },
} as unknown as AnyConfigNode;

const nested = {
  paymentType: { value: "card" },
  passport: {
    number: { value: "" },
  },
} as unknown as AnyConfigNode;

// ─── Тесты ───────────────────────────────────────────────────────────────────

describe("GroupDepsMap", () => {
  describe("конструктор — инициализация зависимостей", () => {
    it("создаёт self-зависимость корня для плоского конфига", () => {
      const { nodePaths, nodeParents } = buildMaps(flat);
      const gdm = new GroupDepsMap(flat, nodePaths, nodeParents);
      expect(gdm.deps.has(pairKey("", ""))).toBe(true);
      expect(gdm.deps.size).toBe(1);
    });

    it("создаёт self-зависимости для корня и вложенных групп", () => {
      const { nodePaths, nodeParents } = buildMaps(nested);
      const gdm = new GroupDepsMap(nested, nodePaths, nodeParents);
      expect(gdm.deps.has(pairKey("", ""))).toBe(true);
      expect(gdm.deps.has(pairKey("passport", "passport"))).toBe(true);
      expect(gdm.deps.size).toBe(2);
    });
  });

  describe("isBuilt / markBuilt", () => {
    it("isBuilt === false сразу после создания", () => {
      const { nodePaths, nodeParents } = buildMaps(flat);
      const gdm = new GroupDepsMap(flat, nodePaths, nodeParents);
      expect(gdm.isBuilt).toBe(false);
    });

    it("isBuilt === true после markBuilt()", () => {
      const { nodePaths, nodeParents } = buildMaps(flat);
      const gdm = new GroupDepsMap(flat, nodePaths, nodeParents);
      gdm.markBuilt();
      expect(gdm.isBuilt).toBe(true);
    });
  });

  describe("getTrackingWrap — захват кросс-групповых зависимостей", () => {
    it("записывает зависимость при чтении значения другой группы", () => {
      const { nodePaths, nodeParents } = buildMaps(nested);
      const gdm = new GroupDepsMap(nested, nodePaths, nodeParents);
      const wrap = gdm.getTrackingWrap();

      // Симулируем вычисление isVisible для листа в группе passport:
      // при чтении values.paymentType (из root) ожидаем запись "" → "passport"
      const passportNumber = (nested as any).passport.number;
      const values = { paymentType: "card", passport: { number: "" } };
      const tracked = wrap(passportNumber, values as any);

      void (tracked as any).paymentType;
      expect(gdm.deps.has(pairKey("", "passport"))).toBe(true);
    });

    it("мемоизирует proxy по recipientPath: повторный вызов для того же узла возвращает тот же объект", () => {
      const { nodePaths, nodeParents } = buildMaps(nested);
      const gdm = new GroupDepsMap(nested, nodePaths, nodeParents);
      const wrap = gdm.getTrackingWrap();

      const passportNumber = (nested as any).passport.number;
      const values = { paymentType: "card", passport: { number: "" } };
      const proxy1 = wrap(passportNumber, values as any);
      const proxy2 = wrap(passportNumber, values as any);
      expect(proxy1).toBe(proxy2);
    });

    it("markBuilt освобождает proxy-кэш (повторный вызов создаёт новый объект)", () => {
      const { nodePaths, nodeParents } = buildMaps(nested);
      const gdm = new GroupDepsMap(nested, nodePaths, nodeParents);
      const wrap = gdm.getTrackingWrap();

      const passportNumber = (nested as any).passport.number;
      const values = { paymentType: "card", passport: { number: "" } };
      const proxy1 = wrap(passportNumber, values as any);

      gdm.markBuilt();

      // После markBuilt кэш очищен — новый Proxy
      const proxy2 = wrap(passportNumber, values as any);
      expect(proxy1).not.toBe(proxy2);
    });
  });
});
