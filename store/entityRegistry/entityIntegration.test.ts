/**
 * Integration tests for Phase 1B: EntityRegistry integrated with Palistor.
 *
 * Покрывает:
 * - store.set() → entity создана / обновлена → notification → recompute
 * - store.delete() → entity удалена → cleanup → notification
 * - Batch set (один recompute + notify для массива)
 * - Merge-поведение (не удаляет отсутствующие поля)
 * - Вложенные объекты
 * - No-op при отсутствии изменений / несуществующем id
 */
import { describe, it, expect, vi } from "vitest";
import { Palistor } from "../store";

function makeStore() {
  return new Palistor({
    config: {
      email: { value: "", label: "Email" },
    },
  });
}

// ─── store.set() ──────────────────────────────────────────────────────────────

describe("store.set()", () => {
  it("создаёт новую entity и увеличивает глобальную версию", () => {
    const store = makeStore();
    const vBefore = store.getVersion();
    store.set({ id: "u1", name: "Alice" });
    expect(store.getVersion()).toBeGreaterThan(vBefore);
  });

  it("entity регистрируется в entityRegistry", () => {
    const store = makeStore();
    store.set({ id: "u1", name: "Alice" });
    const entity = store.entityRegistry.get("u1");
    expect(entity).toBeDefined();
    expect((entity!.name as { value: unknown }).value).toBe("Alice");
  });

  it("уведомляет глобальных подписчиков при создании entity", () => {
    const store = makeStore();
    const listener = vi.fn();
    store.subscribeGlobal(listener);
    store.set({ id: "u1", name: "Alice" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("уведомляет при обновлении entity (merge)", () => {
    const store = makeStore();
    store.set({ id: "u1", name: "Alice" });
    const listener = vi.fn();
    store.subscribeGlobal(listener);
    store.set({ id: "u1", name: "Alice Updated" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("обновляет значение entity при merge", () => {
    const store = makeStore();
    store.set({ id: "u1", name: "Alice" });
    store.set({ id: "u1", name: "Alice Updated" });
    const entity = store.entityRegistry.get("u1");
    expect((entity!.name as { value: unknown }).value).toBe("Alice Updated");
  });

  it("не уведомляет при set с теми же значениями (no-op)", () => {
    const store = makeStore();
    store.set({ id: "u1", name: "Alice" });
    const listener = vi.fn();
    store.subscribeGlobal(listener);
    store.set({ id: "u1", name: "Alice" }); // те же значения
    expect(listener).not.toHaveBeenCalled();
  });

  it("merge: не удаляет поля, отсутствующие в data", () => {
    const store = makeStore();
    store.set({ id: "u1", name: "Alice", email: "alice@example.com" });
    store.set({ id: "u1", name: "Alice Updated" }); // без email
    const entity = store.entityRegistry.get("u1");
    expect((entity!.name as { value: unknown }).value).toBe("Alice Updated");
    expect((entity!.email as { value: unknown }).value).toBe("alice@example.com"); // сохранено
  });

  it("merge: добавляет новые поля в существующую entity", () => {
    const store = makeStore();
    store.set({ id: "u1", name: "Alice" });
    store.set({ id: "u1", role: "admin" });
    const entity = store.entityRegistry.get("u1");
    expect((entity!.name as { value: unknown }).value).toBe("Alice"); // сохранено
    expect((entity!.role as { value: unknown }).value).toBe("admin"); // добавлено
  });

  it("batch: set с массивом entities", () => {
    const store = makeStore();
    const vBefore = store.getVersion();
    store.set([
      { id: "u1", name: "Alice" },
      { id: "u2", name: "Bob" },
    ]);
    expect(store.getVersion()).toBeGreaterThan(vBefore);
    expect(store.entityRegistry.get("u1")).toBeDefined();
    expect(store.entityRegistry.get("u2")).toBeDefined();
  });

  it("batch: ровно один notify для массива (batched recompute)", () => {
    const store = makeStore();
    const listener = vi.fn();
    store.subscribeGlobal(listener);
    store.set([
      { id: "u1", name: "Alice" },
      { id: "u2", name: "Bob" },
    ]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("автогенерация id если id не указан", () => {
    const store = makeStore();
    store.set({ name: "Anon" });
    expect(store.entityRegistry.size).toBe(1);
  });

  it("поддерживает вложенные объекты", () => {
    const store = makeStore();
    store.set({
      id: "u1",
      passport: { number: "ABC123", expiry: "2030-01-01" },
    });
    const entity = store.entityRegistry.get("u1");
    const passport = entity!.passport as Record<string, { value: unknown }>;
    expect(passport.number.value).toBe("ABC123");
    expect(passport.expiry.value).toBe("2030-01-01");
  });

  it("уведомляет per-node подписчика изменившегося leaf-узла", () => {
    const store = makeStore();
    store.set({ id: "u1", name: "Alice" });
    const nameLeaf = store.entityRegistry.get("u1")!.name as object;
    const listener = vi.fn();
    store.subscribe(nameLeaf, listener);
    store.set({ id: "u1", name: "Alice Updated" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("не уведомляет per-node подписчика если значение не изменилось", () => {
    const store = makeStore();
    store.set({ id: "u1", name: "Alice" });
    const nameLeaf = store.entityRegistry.get("u1")!.name as object;
    const listener = vi.fn();
    store.subscribe(nameLeaf, listener);
    store.set({ id: "u1", name: "Alice" }); // то же значение
    expect(listener).not.toHaveBeenCalled();
  });
});

// ─── store.delete() ───────────────────────────────────────────────────────────

describe("store.delete()", () => {
  it("удаляет entity из реестра", () => {
    const store = makeStore();
    store.set({ id: "u1", name: "Alice" });
    store.delete("u1");
    expect(store.entityRegistry.has("u1")).toBe(false);
  });

  it("увеличивает глобальную версию при delete", () => {
    const store = makeStore();
    store.set({ id: "u1", name: "Alice" });
    const vBefore = store.getVersion();
    store.delete("u1");
    expect(store.getVersion()).toBeGreaterThan(vBefore);
  });

  it("уведомляет глобальных подписчиков при delete", () => {
    const store = makeStore();
    store.set({ id: "u1", name: "Alice" });
    const listener = vi.fn();
    store.subscribeGlobal(listener);
    store.delete("u1");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("no-op если entity не существует — версия не меняется", () => {
    const store = makeStore();
    const vBefore = store.getVersion();
    store.delete("nonexistent");
    expect(store.getVersion()).toBe(vBefore);
  });

  it("no-op если entity не существует — подписчики не вызываются", () => {
    const store = makeStore();
    const listener = vi.fn();
    store.subscribeGlobal(listener);
    store.delete("nonexistent");
    expect(listener).not.toHaveBeenCalled();
  });

  it("очищает bindings при delete", () => {
    const store = makeStore();
    const template = {};
    store.set({ id: "u1", name: "Alice" });
    store.entityRegistry.bind("u1", template);
    store.delete("u1");
    expect(store.entityRegistry.has("u1")).toBe(false);
    expect(store.entityRegistry.getBindings("u1")).toBeUndefined();
  });

  it("очищает resolvedCache при delete", () => {
    const store = makeStore();
    const template = {};
    store.set({ id: "u1", name: "Alice" });
    store.entityRegistry.markResolved("u1", template);
    store.delete("u1");
    expect(store.entityRegistry.isResolved("u1", template)).toBe(false);
  });

  it("удалённые leaf-ноды убираются из leafNodes (защита от утечки памяти)", () => {
    const store = makeStore();
    const leafCountBefore = store.nodes.leafNodes.length;
    store.set({ id: "u1", name: "Alice", email: "alice@example.com" });
    expect(store.nodes.leafNodes.length).toBeGreaterThan(leafCountBefore);
    store.delete("u1");
    expect(store.nodes.leafNodes.length).toBe(leafCountBefore);
  });
});
