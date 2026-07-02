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

// Две sibling-группы: `b` (групповой узел) читает лист другой группы `a`.
// Это настоящая кросс-групповая зависимость для group-node isVisible.
const siblingGroups = {
  a: { kind: { value: "" } },
  b: { x: { value: "" } },
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
    it("записывает зависимость при чтении листа ДРУГОЙ sibling-группы", () => {
      const { nodePaths, nodeParents } = buildMaps(siblingGroups);
      const gdm = new GroupDepsMap(siblingGroups, nodePaths, nodeParents);
      const wrap = gdm.getTrackingWrap();

      // Групповой узел `b` (isVisible) получает scope родителя (root). Его compute-
      // запись лежит под РОДИТЕЛЕМ (root), поэтому реципиент зависимости = "" (root),
      // а не собственный путь "b". Чтение values.a.kind → донор "a" ≠ реципиент ""
      // → записывается пара "a" → "".
      const b = (siblingGroups as any).b;
      const rootValues = { a: { kind: "" }, b: { x: "" } };
      const tracked = wrap(b, rootValues as any);

      void (tracked as any).a.kind;
      expect(gdm.deps.has(pairKey("a", ""))).toBe(true);
      // Зависимость НЕ пишется на own-path группы — иначе recompute "b" трогает
      // только детей b, но не её собственный isVisible-энтри (он под root).
      expect(gdm.deps.has(pairKey("a", "b"))).toBe(false);
    });

    it("чтение листа той же (родительской) группы не создаёт кросс-групповую пару", () => {
      const { nodePaths, nodeParents } = buildMaps(nested);
      const gdm = new GroupDepsMap(nested, nodePaths, nodeParents);
      const wrap = gdm.getTrackingWrap();

      // passport (групповой узел) читает root-level sibling paymentType. Обе записи —
      // под root, поэтому это self-зависимость root ("" → ""), уже покрытая
      // конструктором; отдельная кросс-групповая пара не нужна.
      const passport = (nested as any).passport;
      const rootValues = { paymentType: "card", passport: { number: "" } };
      const tracked = wrap(passport, rootValues as any);

      void (tracked as any).paymentType;
      expect(gdm.deps.has(pairKey("", "passport"))).toBe(false);
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
