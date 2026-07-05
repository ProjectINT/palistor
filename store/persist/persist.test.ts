import { describe, it, expect, vi, beforeEach } from "vitest";
import { Palistor } from "../store";
import type { PersistDriver } from "./types";

// ─── In-memory driver for tests ──────────────────────────────────────────────

function createMemoryDriver(): PersistDriver & { storage: Map<string, string> } {
  const storage = new Map<string, string>();
  return {
    storage,
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  };
}

// ─── Async driver for tests ──────────────────────────────────────────────────

function createAsyncMemoryDriver(): PersistDriver & { storage: Map<string, string> } {
  const storage = new Map<string, string>();
  return {
    storage,
    getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: string) => { storage.set(key, value); },
    removeItem: async (key: string) => { storage.delete(key); },
  };
}

// ─── Test config ─────────────────────────────────────────────────────────────

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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("PersistManager", () => {
  let driver: ReturnType<typeof createMemoryDriver>;

  beforeEach(() => {
    driver = createMemoryDriver();
    vi.useFakeTimers();
  });

  // ─── enable / disable ────────────────────────────────────────────────────

  describe("enable / disable", () => {
    it("isEnabled returns false before enable is called", () => {
      const store = new Palistor({ config: makeConfig() });
      expect(store.persist.isEnabled()).toBe(false);
    });

    it("isEnabled returns true after enable", async () => {
      const store = new Palistor({ config: makeConfig() });
      await store.persist.enable({ key: "test", driver });
      expect(store.persist.isEnabled()).toBe(true);
    });

    it("isEnabled returns false after disable", async () => {
      const store = new Palistor({ config: makeConfig() });
      await store.persist.enable({ key: "test", driver });
      store.persist.disable();
      expect(store.persist.isEnabled()).toBe(false);
    });
  });

  // ─── Auto-save ────────────────────────────────────────────────────────────

  describe("auto-save", () => {
    it("saves values on change (after the debounce)", async () => {
      const store = new Palistor({ config: makeConfig() });
      await store.persist.enable({ key: "test", driver, debounce: 50 });

      store.proxy.email.value = "user@test.com";

      // Before the debounce elapses — nothing is saved
      expect(driver.storage.has("test")).toBe(false);

      // Advance the timer
      vi.advanceTimersByTime(60);

      // Now it should be saved
      const saved = JSON.parse(driver.storage.get("test")!);
      expect(saved.email).toBe("user@test.com");
    });

    it("debounce: 0 — immediate save", async () => {
      const store = new Palistor({ config: makeConfig() });
      await store.persist.enable({ key: "test", driver, debounce: 0 });

      store.proxy.name.value = "John";

      // A microtick is needed for the Promise.resolve inside saveToStorage
      await vi.advanceTimersByTimeAsync(0);

      const saved = JSON.parse(driver.storage.get("test")!);
      expect(saved.name).toBe("John");
    });

    it("does not save after disable", async () => {
      const store = new Palistor({ config: makeConfig() });
      await store.persist.enable({ key: "test", driver, debounce: 50 });

      store.persist.disable();
      store.proxy.email.value = "changed@test.com";

      vi.advanceTimersByTime(100);
      expect(driver.storage.has("test")).toBe(false);
    });
  });

  // ─── Hydration ───────────────────────────────────────────────────────────

  describe("hydrate", () => {
    it("restores values from storage on enable", async () => {
      const saved = { email: "saved@test.com", name: "Saved Name" };
      driver.storage.set("hydrate-key", JSON.stringify(saved));

      const store = new Palistor({ config: makeConfig() });
      await store.persist.enable({ key: "hydrate-key", driver });

      expect(store.proxy.email.value).toBe("saved@test.com");
      expect(store.proxy.name.value).toBe("Saved Name");
    });

    it("restores nested objects", async () => {
      const saved = { passport: { number: "1234567890", issueDate: "2020-01-01" } };
      driver.storage.set("nested", JSON.stringify(saved));

      const store = new Palistor({ config: makeConfig() });
      await store.persist.enable({ key: "nested", driver });

      expect(store.proxy.passport.number.value).toBe("1234567890");
      expect(store.proxy.passport.issueDate.value).toBe("2020-01-01");
    });

    it("does not crash when storage has no data", async () => {
      const store = new Palistor({ config: makeConfig() });
      await store.persist.enable({ key: "nonexistent", driver });

      // Values keep their defaults
      expect(store.proxy.email.value).toBe("");
    });

    it("does not crash on corrupted JSON in storage", async () => {
      driver.storage.set("broken", "not-valid-json{{{");

      const store = new Palistor({ config: makeConfig() });
      // Must not throw
      await store.persist.enable({ key: "broken", driver });
      expect(store.proxy.email.value).toBe("");
    });

    it("hydration does not trigger auto-save (no loop)", async () => {
      const saved = { email: "hydrated@test.com" };
      driver.storage.set("cycle-test", JSON.stringify(saved));

      const setItemSpy = vi.spyOn(driver, "setItem");
      const store = new Palistor({ config: makeConfig() });
      await store.persist.enable({ key: "cycle-test", driver, debounce: 0 });

      // setItem must not be called during hydration
      await vi.advanceTimersByTimeAsync(10);
      expect(setItemSpy).not.toHaveBeenCalled();
    });
  });

  // ─── flush ────────────────────────────────────────────────────────────────

  describe("flush", () => {
    it("force-saves without waiting for the debounce", async () => {
      const store = new Palistor({ config: makeConfig() });
      await store.persist.enable({ key: "flush-test", driver, debounce: 5000 });

      store.proxy.email.value = "flushed@test.com";
      await store.persist.flush();

      const saved = JSON.parse(driver.storage.get("flush-test")!);
      expect(saved.email).toBe("flushed@test.com");
    });
  });

  // ─── clear ────────────────────────────────────────────────────────────────

  describe("clear", () => {
    it("removes the data from storage", async () => {
      driver.storage.set("clear-test", JSON.stringify({ email: "x" }));

      const store = new Palistor({ config: makeConfig() });
      await store.persist.enable({ key: "clear-test", driver });
      await store.persist.clear();

      expect(driver.storage.has("clear-test")).toBe(false);
    });
  });

  // ─── pick / omit ─────────────────────────────────────────────────────────

  describe("pick / omit", () => {
    it("pick — persists only the listed fields", async () => {
      const store = new Palistor({ config: makeConfig() });
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

    it("omit — excludes the listed fields", async () => {
      const store = new Palistor({ config: makeConfig() });
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
    it("works with an async driver", async () => {
      const asyncDriver = createAsyncMemoryDriver();
      asyncDriver.storage.set("async-key", JSON.stringify({ email: "async@test.com" }));

      const store = new Palistor({ config: makeConfig() });
      await store.persist.enable({ key: "async-key", driver: asyncDriver });

      expect(store.proxy.email.value).toBe("async@test.com");
    });

    it("saves through an async driver", async () => {
      const asyncDriver = createAsyncMemoryDriver();
      const store = new Palistor({ config: makeConfig() });
      await store.persist.enable({ key: "async-save", driver: asyncDriver, debounce: 0 });

      store.proxy.name.value = "Async Name";
      await store.persist.flush();

      const saved = JSON.parse(asyncDriver.storage.get("async-save")!);
      expect(saved.name).toBe("Async Name");
    });
  });

  // ─── Custom serialize / deserialize ────────────────────────────────────────

  describe("custom serializer", () => {
    it("uses custom serialize / deserialize", async () => {
      const prefix = "CUSTOM:";
      const store = new Palistor({ config: makeConfig() });

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

  // ─── Re-enable (key change) ───────────────────────────────────────────────

  describe("re-enable", () => {
    it("a repeated enable switches to the new key", async () => {
      const store = new Palistor({ config: makeConfig() });

      driver.storage.set("key-1", JSON.stringify({ email: "key1@test.com" }));
      driver.storage.set("key-2", JSON.stringify({ email: "key2@test.com" }));

      await store.persist.enable({ key: "key-1", driver });
      expect(store.proxy.email.value).toBe("key1@test.com");

      await store.persist.enable({ key: "key-2", driver });
      expect(store.proxy.email.value).toBe("key2@test.com");
    });
  });

  // ─── Persist cleanup after a successful submit ───────────────────────────────

  describe("clear on successful submit", () => {
    it("the persist storage is cleared after a successful submit", async () => {
      const config = {
        email: { value: "", label: "Email", isRequired: true },
        name: { value: "", label: "Name" },
        onSubmit: async () => ({ ok: true }),
      };
      const store = new Palistor({ config });

      await store.persist.enable({ key: "submit-clear", driver });

      // Write the values
      store.proxy.email.value = "test@test.com";
      store.proxy.name.value = "John";
      await store.persist.flush();

      // Ensure the data is in storage
      expect(driver.storage.has("submit-clear")).toBe(true);

      // A successful submit
      const result = await store.submit();
      expect(result.success).toBe(true);

      // Storage is cleared
      expect(driver.storage.has("submit-clear")).toBe(false);
    });

    it("the persist storage is NOT cleared on a failed submit (validation errors)", async () => {
      const config = {
        email: {
          value: "",
          label: "Email",
          isRequired: true,
          validate: (v: string) => (!v ? "required" : undefined),
        },
        name: { value: "", label: "Name" },
      };
      const store = new Palistor({ config });

      await store.persist.enable({ key: "submit-fail", driver });

      store.proxy.name.value = "John";
      await store.persist.flush();

      expect(driver.storage.has("submit-fail")).toBe(true);

      // Submit fails due to email validation
      const result = await store.submit();
      expect(result.success).toBe(false);

      // Storage is NOT cleared
      expect(driver.storage.has("submit-fail")).toBe(true);
    });

    it("the persist storage is NOT cleared when persist is inactive", async () => {
      const config = {
        email: { value: "", label: "Email" },
        onSubmit: async () => ({ ok: true }),
      };
      const store = new Palistor({ config });

      // Persist is NOT enabled — submit must not crash
      const result = await store.submit();
      expect(result.success).toBe(true);
    });
  });
});
