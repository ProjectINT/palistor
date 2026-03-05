import { describe, it, expect, vi, beforeEach } from "vitest";
import { createProxyStore } from "../store";
import { createPersistManager } from "./persistManager";
import type { PersistDriver } from "./types";

// ─── In-memory driver для тестов ─────────────────────────────────────────────

function createMemoryDriver(): PersistDriver & { storage: Map<string, string> } {
  const storage = new Map<string, string>();
  return {
    storage,
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  };
}

// ─── Async driver для тестов ─────────────────────────────────────────────────

function createAsyncMemoryDriver(): PersistDriver & { storage: Map<string, string> } {
  const storage = new Map<string, string>();
  return {
    storage,
    getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: string) => { storage.set(key, value); },
    removeItem: async (key: string) => { storage.delete(key); },
  };
}

// ─── Тестовый конфиг ─────────────────────────────────────────────────────────

const makeConfig = () => ({
  email: {
    value: "",
    label: "Email",
  },
  name: {
    value: "",
    label: "Name",
  },
  age: {
    value: 0,
    label: "Age",
  },
  passport: {
    number: {
      value: "",
      label: "Passport Number",
    },
    issueDate: {
      value: "",
      label: "Issue Date",
    },
  },
});

// ─── Тесты ───────────────────────────────────────────────────────────────────

describe("PersistManager", () => {
  let driver: ReturnType<typeof createMemoryDriver>;

  beforeEach(() => {
    driver = createMemoryDriver();
    vi.useFakeTimers();
  });

  // ─── enable / disable ────────────────────────────────────────────────────

  describe("enable / disable", () => {
    it("isEnabled возвращает false до вызова enable", () => {
      const store = createProxyStore({ config: makeConfig() });
      expect(store.persist.isEnabled()).toBe(false);
    });

    it("isEnabled возвращает true после enable", async () => {
      const store = createProxyStore({ config: makeConfig() });
      await store.persist.enable({ key: "test", driver });
      expect(store.persist.isEnabled()).toBe(true);
    });

    it("isEnabled возвращает false после disable", async () => {
      const store = createProxyStore({ config: makeConfig() });
      await store.persist.enable({ key: "test", driver });
      store.persist.disable();
      expect(store.persist.isEnabled()).toBe(false);
    });
  });

  // ─── Автосохранение ──────────────────────────────────────────────────────

  describe("auto-save", () => {
    it("сохраняет значения при изменении (после debounce)", async () => {
      const store = createProxyStore({ config: makeConfig() });
      await store.persist.enable({ key: "test", driver, debounce: 50 });

      store.proxy.email.value = "user@test.com";

      // До истечения debounce — ничего не сохранено
      expect(driver.storage.has("test")).toBe(false);

      // Прокрутим таймер
      vi.advanceTimersByTime(60);

      // Теперь должно быть сохранено
      const saved = JSON.parse(driver.storage.get("test")!);
      expect(saved.email).toBe("user@test.com");
    });

    it("debounce: 0 — мгновенное сохранение", async () => {
      const store = createProxyStore({ config: makeConfig() });
      await store.persist.enable({ key: "test", driver, debounce: 0 });

      store.proxy.name.value = "John";

      // Нужен микротик для Promise.resolve внутри saveToStorage
      await vi.advanceTimersByTimeAsync(0);

      const saved = JSON.parse(driver.storage.get("test")!);
      expect(saved.name).toBe("John");
    });

    it("не сохраняет после disable", async () => {
      const store = createProxyStore({ config: makeConfig() });
      await store.persist.enable({ key: "test", driver, debounce: 50 });

      store.persist.disable();
      store.proxy.email.value = "changed@test.com";

      vi.advanceTimersByTime(100);
      expect(driver.storage.has("test")).toBe(false);
    });
  });

  // ─── Гидратация ──────────────────────────────────────────────────────────

  describe("hydrate", () => {
    it("восстанавливает значения из storage при enable", async () => {
      const saved = { email: "saved@test.com", name: "Saved Name" };
      driver.storage.set("hydrate-key", JSON.stringify(saved));

      const store = createProxyStore({ config: makeConfig() });
      await store.persist.enable({ key: "hydrate-key", driver });

      expect(store.proxy.email.value).toBe("saved@test.com");
      expect(store.proxy.name.value).toBe("Saved Name");
    });

    it("восстанавливает вложенные объекты", async () => {
      const saved = { passport: { number: "1234567890", issueDate: "2020-01-01" } };
      driver.storage.set("nested", JSON.stringify(saved));

      const store = createProxyStore({ config: makeConfig() });
      await store.persist.enable({ key: "nested", driver });

      expect(store.proxy.passport.number.value).toBe("1234567890");
      expect(store.proxy.passport.issueDate.value).toBe("2020-01-01");
    });

    it("не падает если в storage нет данных", async () => {
      const store = createProxyStore({ config: makeConfig() });
      await store.persist.enable({ key: "nonexistent", driver });

      // Значения остаются по умолчанию
      expect(store.proxy.email.value).toBe("");
    });

    it("не падает при битом JSON в storage", async () => {
      driver.storage.set("broken", "not-valid-json{{{");

      const store = createProxyStore({ config: makeConfig() });
      // Не должно бросать исключение
      await store.persist.enable({ key: "broken", driver });
      expect(store.proxy.email.value).toBe("");
    });

    it("гидратация не тригерит автосохранение (нет цикла)", async () => {
      const saved = { email: "hydrated@test.com" };
      driver.storage.set("cycle-test", JSON.stringify(saved));

      const setItemSpy = vi.spyOn(driver, "setItem");
      const store = createProxyStore({ config: makeConfig() });
      await store.persist.enable({ key: "cycle-test", driver, debounce: 0 });

      // setItem не должен вызываться во время гидратации
      await vi.advanceTimersByTimeAsync(10);
      expect(setItemSpy).not.toHaveBeenCalled();
    });
  });

  // ─── flush ────────────────────────────────────────────────────────────────

  describe("flush", () => {
    it("принудительно сохраняет без ожидания debounce", async () => {
      const store = createProxyStore({ config: makeConfig() });
      await store.persist.enable({ key: "flush-test", driver, debounce: 5000 });

      store.proxy.email.value = "flushed@test.com";
      await store.persist.flush();

      const saved = JSON.parse(driver.storage.get("flush-test")!);
      expect(saved.email).toBe("flushed@test.com");
    });
  });

  // ─── clear ────────────────────────────────────────────────────────────────

  describe("clear", () => {
    it("удаляет данные из storage", async () => {
      driver.storage.set("clear-test", JSON.stringify({ email: "x" }));

      const store = createProxyStore({ config: makeConfig() });
      await store.persist.enable({ key: "clear-test", driver });
      await store.persist.clear();

      expect(driver.storage.has("clear-test")).toBe(false);
    });
  });

  // ─── pick / omit ─────────────────────────────────────────────────────────

  describe("pick / omit", () => {
    it("pick — сохраняет только указанные поля", async () => {
      const store = createProxyStore({ config: makeConfig() });
      await store.persist.enable({
        key: "pick-test",
        driver,
        debounce: 0,
        pick: ["email", "name"],
      });

      store.proxy.email.value = "pick@test.com";
      store.proxy.name.value = "Pick Name";
      store.proxy.age.value = 25;

      await store.persist.flush();

      const saved = JSON.parse(driver.storage.get("pick-test")!);
      expect(saved.email).toBe("pick@test.com");
      expect(saved.name).toBe("Pick Name");
      expect(saved.age).toBeUndefined();
    });

    it("omit — исключает указанные поля", async () => {
      const store = createProxyStore({ config: makeConfig() });
      await store.persist.enable({
        key: "omit-test",
        driver,
        debounce: 0,
        omit: ["age"],
      });

      store.proxy.email.value = "omit@test.com";
      store.proxy.age.value = 30;

      await store.persist.flush();

      const saved = JSON.parse(driver.storage.get("omit-test")!);
      expect(saved.email).toBe("omit@test.com");
      expect(saved.age).toBeUndefined();
    });
  });

  // ─── Async driver ─────────────────────────────────────────────────────────

  describe("async driver", () => {
    it("работает с асинхронным драйвером", async () => {
      const asyncDriver = createAsyncMemoryDriver();
      asyncDriver.storage.set("async-key", JSON.stringify({ email: "async@test.com" }));

      const store = createProxyStore({ config: makeConfig() });
      await store.persist.enable({ key: "async-key", driver: asyncDriver });

      expect(store.proxy.email.value).toBe("async@test.com");
    });

    it("сохраняет через асинхронный драйвер", async () => {
      const asyncDriver = createAsyncMemoryDriver();
      const store = createProxyStore({ config: makeConfig() });
      await store.persist.enable({ key: "async-save", driver: asyncDriver, debounce: 0 });

      store.proxy.name.value = "Async Name";
      await store.persist.flush();

      const saved = JSON.parse(asyncDriver.storage.get("async-save")!);
      expect(saved.name).toBe("Async Name");
    });
  });

  // ─── Custom serialize / deserialize ────────────────────────────────────────

  describe("custom serializer", () => {
    it("использует кастомный serialize / deserialize", async () => {
      const prefix = "CUSTOM:";
      const store = createProxyStore({ config: makeConfig() });

      driver.storage.set(
        "custom-serde",
        prefix + JSON.stringify({ email: "custom@test.com" }),
      );

      await store.persist.enable({
        key: "custom-serde",
        driver,
        debounce: 0,
        serialize: (v) => prefix + JSON.stringify(v),
        deserialize: (raw) => JSON.parse(raw.slice(prefix.length)),
      });

      expect(store.proxy.email.value).toBe("custom@test.com");

      store.proxy.name.value = "Custom";
      await store.persist.flush();

      const raw = driver.storage.get("custom-serde")!;
      expect(raw.startsWith(prefix)).toBe(true);
      const saved = JSON.parse(raw.slice(prefix.length));
      expect(saved.name).toBe("Custom");
    });
  });

  // ─── Re-enable (смена ключа) ──────────────────────────────────────────────

  describe("re-enable", () => {
    it("при повторном enable — переключается на новый ключ", async () => {
      const store = createProxyStore({ config: makeConfig() });

      driver.storage.set("key-1", JSON.stringify({ email: "key1@test.com" }));
      driver.storage.set("key-2", JSON.stringify({ email: "key2@test.com" }));

      await store.persist.enable({ key: "key-1", driver });
      expect(store.proxy.email.value).toBe("key1@test.com");

      await store.persist.enable({ key: "key-2", driver });
      expect(store.proxy.email.value).toBe("key2@test.com");
    });
  });
});
