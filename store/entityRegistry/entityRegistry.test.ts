import { describe, it, expect, beforeEach } from "vitest";
import { EntityRegistry } from "./entityRegistry";
import type { EntityNode } from "./types";

// ─── Тестовые данные ─────────────────────────────────────────────────────────

const template1 = { name: "template1" }; // простой объект-заглушка template ноды
const template2 = { name: "template2" };

// ─── Тесты EntityRegistry ────────────────────────────────────────────────────

describe("EntityRegistry", () => {

  // ── 1A.1 + 1A.2: CRUD и EntityNode ───────────────────────────────────────

  describe("upsert — создание", () => {
    it("создаёт новую entity с leaf-нодами", () => {
      const registry = new EntityRegistry();
      const node = registry.upsert({ id: "u1", name: "Alice", age: 30 });

      expect(node).toBeDefined();
      expect(node.id.value).toBe("u1");
      expect((node.name as any).value).toBe("Alice");
      expect((node.age as any).value).toBe(30);
    });

    it("возвращает ту же ноду, что хранится в registry", () => {
      const registry = new EntityRegistry();
      const returned = registry.upsert({ id: "u1", name: "Alice" });
      const stored = registry.get("u1");
      expect(returned).toBe(stored);
    });

    it("поддерживает вложенные объекты (groups)", () => {
      const registry = new EntityRegistry();
      const node = registry.upsert({ id: "u1", passport: { number: "123", issueDate: "2020-01-01" } });

      const passport = node.passport as EntityNode;
      expect(passport).toBeDefined();
      expect("value" in passport).toBe(false); // это группа, не leaf
      expect((passport.number as any).value).toBe("123");
      expect((passport.issueDate as any).value).toBe("2020-01-01");
    });

    it("создаёт leaf для null значений", () => {
      const registry = new EntityRegistry();
      const node = registry.upsert({ id: "u1", name: null });
      expect((node.name as any).value).toBeNull();
    });

    it("создаёт leaf для числовых значений", () => {
      const registry = new EntityRegistry();
      const node = registry.upsert({ id: "u1", count: 0 });
      expect((node.count as any).value).toBe(0);
    });

    it("создаёт leaf для булевых значений", () => {
      const registry = new EntityRegistry();
      const node = registry.upsert({ id: "u1", active: false });
      expect((node.active as any).value).toBe(false);
    });

    it("НЕ создаёт leaf для поля id (специальный случай)", () => {
      const registry = new EntityRegistry();
      const node = registry.upsert({ id: "u1", name: "Alice" });
      // id — это отдельная leaf, не дублируется
      expect(Object.keys(node)).toContain("id");
      expect((node.id as any).value).toBe("u1");
    });
  });

  describe("upsert — merge (обновление)", () => {
    it("обновляет существующие поля, не удаляя отсутствующие", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1", name: "Alice", age: 30 });
      const node = registry.upsert({ id: "u1", name: "Alice Updated" });

      expect((node.name as any).value).toBe("Alice Updated");
      // age не было в обновлении — остаётся
      expect((node.age as any).value).toBe(30);
    });

    it("возвращает тот же объект-ноду при merge (shared reference)", () => {
      const registry = new EntityRegistry();
      const first = registry.upsert({ id: "u1", name: "Alice" });
      const second = registry.upsert({ id: "u1", name: "Bob" });
      expect(first).toBe(second);
    });

    it("обновляет leaf in-place (mutation, не замена)", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1", name: "Alice" });
      const node = registry.get("u1")!;
      const nameLeaf = node.name as any;

      registry.upsert({ id: "u1", name: "Bob" });

      // nameLeaf — тот же объект, только value изменилось
      expect(nameLeaf.value).toBe("Bob");
      expect(node.name).toBe(nameLeaf); // ссылка сохранена
    });

    it("добавляет новые поля при merge", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1", name: "Alice" });
      registry.upsert({ id: "u1", email: "alice@example.com" });
      const node = registry.get("u1")!;

      expect((node.name as any).value).toBe("Alice");
      expect((node.email as any).value).toBe("alice@example.com");
    });

    it("рекурсивный merge вложенных групп", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1", passport: { number: "123", issueDate: "2020-01-01" } });
      registry.upsert({ id: "u1", passport: { number: "456" } }); // только number обновляем

      const node = registry.get("u1")!;
      const passport = node.passport as EntityNode;

      expect((passport.number as any).value).toBe("456");
      expect((passport.issueDate as any).value).toBe("2020-01-01"); // не удалено
    });

    it("рекурсивный merge обновляет вложенный leaf in-place", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1", passport: { number: "123" } });
      const passportNode = (registry.get("u1")! as any).passport;
      const numberLeaf = passportNode.number;

      registry.upsert({ id: "u1", passport: { number: "999" } });

      // Тот же объект-лист, изменён in-place
      expect(numberLeaf.value).toBe("999");
      expect(passportNode.number).toBe(numberLeaf);
    });
  });

  describe("get / has / size / delete", () => {
    it("get возвращает undefined для несуществующей entity", () => {
      const registry = new EntityRegistry();
      expect(registry.get("nonexistent")).toBeUndefined();
    });

    it("has возвращает true для существующей entity", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1" });
      expect(registry.has("u1")).toBe(true);
    });

    it("has возвращает false для несуществующей entity", () => {
      const registry = new EntityRegistry();
      expect(registry.has("u1")).toBe(false);
    });

    it("size отражает количество entities", () => {
      const registry = new EntityRegistry();
      expect(registry.size).toBe(0);
      registry.upsert({ id: "u1" });
      expect(registry.size).toBe(1);
      registry.upsert({ id: "u2" });
      expect(registry.size).toBe(2);
    });

    it("delete удаляет entity", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1" });
      const result = registry.delete("u1");

      expect(result).toBe(true);
      expect(registry.has("u1")).toBe(false);
      expect(registry.size).toBe(0);
    });

    it("delete возвращает false для несуществующей entity", () => {
      const registry = new EntityRegistry();
      expect(registry.delete("u1")).toBe(false);
    });

    it("delete очищает bindings", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1" });
      registry.bind("u1", template1);
      registry.delete("u1");

      // После пересоздания entity — bindings уже нет
      registry.upsert({ id: "u1" });
      expect(registry.getBindings("u1")).toBeUndefined();
    });

    it("delete очищает resolvedCache", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1" });
      registry.markResolved("u1", template1);
      registry.delete("u1");

      // После пересоздания — resolve не числится выполненным
      registry.upsert({ id: "u1" });
      expect(registry.isResolved("u1", template1)).toBe(false);
    });
  });

  // ── 1A.3: ID auto-generation ──────────────────────────────────────────────

  describe("ID auto-generation", () => {
    it("генерирует _tmp_ id когда id не указан", () => {
      const registry = new EntityRegistry();
      const node = registry.upsert({ name: "NoId" });
      expect((node.id as any).value).toMatch(/^_tmp_/);
    });

    it("генерирует _tmp_ id когда id пустая строка", () => {
      const registry = new EntityRegistry();
      const node = registry.upsert({ id: "", name: "EmptyId" });
      expect((node.id as any).value).toMatch(/^_tmp_/);
    });

    it("генерирует _tmp_ id когда id состоит из пробелов", () => {
      const registry = new EntityRegistry();
      const node = registry.upsert({ id: "   ", name: "SpaceId" });
      expect((node.id as any).value).toMatch(/^_tmp_/);
    });

    it("генерирует уникальные _tmp_ id при множественных вызовах", () => {
      const registry = new EntityRegistry();
      const node1 = registry.upsert({ name: "First" });
      const node2 = registry.upsert({ name: "Second" });
      expect((node1.id as any).value).not.toBe((node2.id as any).value);
    });

    it("использует явный id когда он передан", () => {
      const registry = new EntityRegistry();
      const node = registry.upsert({ id: "u1", name: "Alice" });
      expect((node.id as any).value).toBe("u1");
    });
  });

  // ── Bind / Unbind ─────────────────────────────────────────────────────────

  describe("bind / unbind / getBindings", () => {
    it("bind добавляет template в Set привязок", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1" });
      registry.bind("u1", template1);

      const bindings = registry.getBindings("u1");
      expect(bindings).toBeDefined();
      expect(bindings!.has(template1)).toBe(true);
    });

    it("bind поддерживает несколько templates для одной entity", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1" });
      registry.bind("u1", template1);
      registry.bind("u1", template2);

      const bindings = registry.getBindings("u1");
      expect(bindings!.size).toBe(2);
      expect(bindings!.has(template1)).toBe(true);
      expect(bindings!.has(template2)).toBe(true);
    });

    it("unbind удаляет template из привязок", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1" });
      registry.bind("u1", template1);
      registry.bind("u1", template2);
      registry.unbind("u1", template1);

      const bindings = registry.getBindings("u1");
      expect(bindings!.has(template1)).toBe(false);
      expect(bindings!.has(template2)).toBe(true);
    });

    it("unbind — no-op если template не был привязан", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1" });
      expect(() => registry.unbind("u1", template1)).not.toThrow();
    });

    it("unbind — no-op если entity не существует", () => {
      const registry = new EntityRegistry();
      expect(() => registry.unbind("nonexistent", template1)).not.toThrow();
    });

    it("getBindings возвращает undefined если нет привязок", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1" });
      expect(registry.getBindings("u1")).toBeUndefined();
    });

    it("getBindings возвращает undefined если entity не существует", () => {
      const registry = new EntityRegistry();
      expect(registry.getBindings("nonexistent")).toBeUndefined();
    });
  });

  // ── Resolved cache ────────────────────────────────────────────────────────

  describe("markResolved / isResolved / clearResolved", () => {
    it("isResolved возвращает false до markResolved", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1" });
      expect(registry.isResolved("u1", template1)).toBe(false);
    });

    it("isResolved возвращает true после markResolved", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1" });
      registry.markResolved("u1", template1);
      expect(registry.isResolved("u1", template1)).toBe(true);
    });

    it("markResolved не влияет на другие templates", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1" });
      registry.markResolved("u1", template1);
      expect(registry.isResolved("u1", template2)).toBe(false);
    });

    it("markResolved не влияет на другие entities", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1" });
      registry.upsert({ id: "u2" });
      registry.markResolved("u1", template1);
      expect(registry.isResolved("u2", template1)).toBe(false);
    });

    it("clearResolved(id) очищает весь кэш для entity", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1" });
      registry.markResolved("u1", template1);
      registry.markResolved("u1", template2);

      registry.clearResolved("u1");

      expect(registry.isResolved("u1", template1)).toBe(false);
      expect(registry.isResolved("u1", template2)).toBe(false);
    });

    it("clearResolved(id, template) очищает только конкретный template", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1" });
      registry.markResolved("u1", template1);
      registry.markResolved("u1", template2);

      registry.clearResolved("u1", template1);

      expect(registry.isResolved("u1", template1)).toBe(false);
      expect(registry.isResolved("u1", template2)).toBe(true); // не тронут
    });

    it("clearResolved — no-op для несуществующего id", () => {
      const registry = new EntityRegistry();
      expect(() => registry.clearResolved("nonexistent")).not.toThrow();
    });

    it("isResolved — false для несуществующего id", () => {
      const registry = new EntityRegistry();
      expect(registry.isResolved("nonexistent", template1)).toBe(false);
    });
  });

  // ── 1A.4: rekey ───────────────────────────────────────────────────────────

  describe("rekey", () => {
    it("перемещает entity с oldId на newId", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "tmp1", name: "Alice" });

      registry.rekey("tmp1", "u1");

      expect(registry.has("tmp1")).toBe(false);
      expect(registry.has("u1")).toBe(true);
    });

    it("обновляет id leaf value", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "tmp1", name: "Alice" });

      registry.rekey("tmp1", "u1");

      const node = registry.get("u1")!;
      expect((node.id as any).value).toBe("u1");
    });

    it("сохраняет данные entity при rekey", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "tmp1", name: "Alice", age: 30 });

      registry.rekey("tmp1", "u1");

      const node = registry.get("u1")!;
      expect((node.name as any).value).toBe("Alice");
      expect((node.age as any).value).toBe(30);
    });

    it("сохраняет ту же ноду-объект (identity сохраняется)", () => {
      const registry = new EntityRegistry();
      const original = registry.upsert({ id: "tmp1", name: "Alice" });

      registry.rekey("tmp1", "u1");

      expect(registry.get("u1")).toBe(original);
    });

    it("переносит bindings на newId", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "tmp1" });
      registry.bind("tmp1", template1);

      registry.rekey("tmp1", "u1");

      expect(registry.getBindings("tmp1")).toBeUndefined();
      const bindings = registry.getBindings("u1");
      expect(bindings).toBeDefined();
      expect(bindings!.has(template1)).toBe(true);
    });

    it("переносит resolvedCache на newId", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "tmp1" });
      registry.markResolved("tmp1", template1);

      registry.rekey("tmp1", "u1");

      expect(registry.isResolved("tmp1", template1)).toBe(false);
      expect(registry.isResolved("u1", template1)).toBe(true);
    });

    it("rekey — no-op для несуществующего oldId", () => {
      const registry = new EntityRegistry();
      expect(() => registry.rekey("nonexistent", "u1")).not.toThrow();
      expect(registry.has("u1")).toBe(false);
    });

    it("rekey entity без bindings и resolvedCache", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "tmp1", name: "Bob" });

      expect(() => registry.rekey("tmp1", "u2")).not.toThrow();
      expect(registry.has("u2")).toBe(true);
    });
  });

  // ── Комплексный сценарий ──────────────────────────────────────────────────

  describe("комплексный сценарий: жизненный цикл entity", () => {
    it("полный цикл: create → bind → markResolved → unbind → delete", () => {
      const registry = new EntityRegistry();

      // Создаём entity
      registry.upsert({ id: "u1", name: "Alice", age: 30 });
      expect(registry.has("u1")).toBe(true);

      // Привязываем к форме
      registry.bind("u1", template1);
      expect(registry.getBindings("u1")!.has(template1)).toBe(true);

      // Resolve выполнен
      registry.markResolved("u1", template1);
      expect(registry.isResolved("u1", template1)).toBe(true);

      // Закрыли форму: unbind
      registry.unbind("u1", template1);
      expect(registry.getBindings("u1")!.has(template1)).toBe(false);

      // Открыли снова — resolve кэш сохранён
      expect(registry.isResolved("u1", template1)).toBe(true);

      // Удалили entity
      registry.delete("u1");
      expect(registry.has("u1")).toBe(false);
    });

    it("tmp → real id: upsert с tmp, rekey на реальный после ответа API", () => {
      const registry = new EntityRegistry();

      // Создали без id → _tmp_
      const tmpNode = registry.upsert({ name: "New User" });
      const tmpId = (tmpNode.id as any).value as string;
      expect(tmpId).toMatch(/^_tmp_/);

      registry.bind(tmpId, template1);
      registry.markResolved(tmpId, template1);

      // Сервер вернул реальный id
      registry.rekey(tmpId, "u99");

      expect(registry.has(tmpId)).toBe(false);
      expect(registry.has("u99")).toBe(true);
      expect((registry.get("u99")!.id as any).value).toBe("u99");
      expect(registry.isResolved("u99", template1)).toBe(true);
    });

    it("несколько entities независимы", () => {
      const registry = new EntityRegistry();

      registry.upsert({ id: "u1", name: "Alice" });
      registry.upsert({ id: "u2", name: "Bob" });
      registry.upsert({ id: "u3", name: "Charlie" });

      // Alice merge
      registry.upsert({ id: "u1", age: 25 });
      expect((registry.get("u1")!.name as any).value).toBe("Alice");

      // Bob delete
      registry.delete("u2");
      expect(registry.has("u2")).toBe(false);
      expect(registry.size).toBe(2);

      // Charlie rekey
      registry.rekey("u3", "charlie-id");
      expect(registry.has("u3")).toBe(false);
      expect(registry.has("charlie-id")).toBe(true);
    });
  });
});
