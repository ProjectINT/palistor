import { describe, it, expect } from "vitest";
import { collectValues, type AnyConfigNode } from "./collectValues";
import { buildValuesCache, updateValuesCacheEntry } from "./valuesCache";
import { type FieldState } from "./compute";

// ─── Вспомогательные функции ─────────────────────────────────────────────────

/**
 * Создаёт минимальный FieldState для теста с заданным value.
 */
function makeState(value: unknown): FieldState {
  return {
    value,
    isRequired: false,
    isReadOnly: false,
    isDisabled: false,
    isVisible: true,
  };
}

/**
 * Создаёт WeakMap с состояниями для переданных пар [узел, value].
 */
function makeNodeState(entries: Array<[object, unknown]>): WeakMap<object, FieldState> {
  const map = new WeakMap<object, FieldState>();
  for (const [node, value] of entries) {
    map.set(node, makeState(value));
  }
  return map;
}

// ─── Тесты: collectValues (legacy) ──────────────────────────────────────────

describe("collectValues", () => {
  it("возвращает пустой объект для пустого узла", () => {
    const nodeState = new WeakMap<object, FieldState>();
    expect(collectValues({}, nodeState)).toEqual({});
  });

  it("собирает value одного листового поля", () => {
    const email = { value: "" };
    const config: AnyConfigNode = { email };
    const nodeState = makeNodeState([[email, "user@example.com"]]);

    expect(collectValues(config, nodeState)).toEqual({ email: "user@example.com" });
  });

  it("собирает value нескольких листовых полей", () => {
    const firstName = { value: "" };
    const lastName = { value: "" };
    const config: AnyConfigNode = { firstName, lastName };
    const nodeState = makeNodeState([
      [firstName, "John"],
      [lastName, "Doe"],
    ]);

    expect(collectValues(config, nodeState)).toEqual({
      firstName: "John",
      lastName: "Doe",
    });
  });

  it("рекурсирует в групповой узел и собирает вложенные поля", () => {
    const number = { value: "" };
    const passport: AnyConfigNode = { number };
    const config: AnyConfigNode = { passport };
    const nodeState = makeNodeState([[number, "AB123456"]]);

    expect(collectValues(config, nodeState)).toEqual({
      passport: { number: "AB123456" },
    });
  });
});

// ─── Тесты: buildValuesCache ─────────────────────────────────────────────────

describe("buildValuesCache", () => {
  it("возвращает пустой объект values для пустого конфига", () => {
    const nodeState = new WeakMap<object, FieldState>();
    const cache = buildValuesCache({}, nodeState);
    expect(cache.values).toEqual({});
  });

  it("собирает значения одного листового поля", () => {
    const email = { value: "" };
    const config: AnyConfigNode = { email };
    const nodeState = makeNodeState([[email, "user@example.com"]]);

    const cache = buildValuesCache(config, nodeState);
    expect(cache.values).toEqual({ email: "user@example.com" });
  });

  it("собирает значения нескольких листовых полей", () => {
    const firstName = { value: "" };
    const lastName = { value: "" };
    const config: AnyConfigNode = { firstName, lastName };
    const nodeState = makeNodeState([
      [firstName, "John"],
      [lastName, "Doe"],
    ]);

    const cache = buildValuesCache(config, nodeState);
    expect(cache.values).toEqual({ firstName: "John", lastName: "Doe" });
  });

  it("рекурсирует в групповой узел", () => {
    const number = { value: "" };
    const passport: AnyConfigNode = { number };
    const config: AnyConfigNode = { passport };
    const nodeState = makeNodeState([[number, "AB123456"]]);

    const cache = buildValuesCache(config, nodeState);
    expect(cache.values).toEqual({ passport: { number: "AB123456" } });
  });

  it("обрабатывает несколько уровней вложенности", () => {
    const street = { value: "" };
    const city = { value: "" };
    const address: AnyConfigNode = { street, city };
    const home: AnyConfigNode = { address };
    const config: AnyConfigNode = { home };
    const nodeState = makeNodeState([
      [street, "Baker St"],
      [city, "London"],
    ]);

    const cache = buildValuesCache(config, nodeState);
    expect(cache.values).toEqual({
      home: { address: { street: "Baker St", city: "London" } },
    });
  });

  it("возвращает '' для листового поля без записи в nodeState", () => {
    const email = { value: "" };
    const config: AnyConfigNode = { email };
    const nodeState = new WeakMap<object, FieldState>();

    const cache = buildValuesCache(config, nodeState);
    expect(cache.values).toEqual({ email: "" });
  });

  it("пропускает служебные ключи CONFIG_PROPS", () => {
    const email = { value: "", label: "Email", validate: () => undefined };
    const config: AnyConfigNode = { email };
    const nodeState = makeNodeState([[email, "test@test.com"]]);

    const cache = buildValuesCache(config, nodeState);
    expect(cache.values).toEqual({ email: "test@test.com" });
    expect(cache.values).not.toHaveProperty("value");
    expect(cache.values).not.toHaveProperty("label");
  });

  it("корректно возвращает falsy-значения (0, false)", () => {
    const count = { value: 0 };
    const checked = { value: false };
    const config: AnyConfigNode = { count, checked };
    const nodeState = makeNodeState([
      [count, 0],
      [checked, false],
    ]);

    const cache = buildValuesCache(config, nodeState);
    expect(cache.values).toEqual({ count: 0, checked: false });
  });

  it("регистрирует nodeSlot для каждого листового узла", () => {
    const email = { value: "" };
    const config: AnyConfigNode = { email };
    const nodeState = makeNodeState([[email, "test"]]);

    const cache = buildValuesCache(config, nodeState);
    const slot = cache.nodeSlot.get(email);
    expect(slot).toBeDefined();
    expect(slot!.key).toBe("email");
    expect(slot!.parent).toBe(cache.values);
  });
});

// ─── Тесты: updateValuesCacheEntry ──────────────────────────────────────────

describe("updateValuesCacheEntry", () => {
  it("обновляет значение в кеше через nodeSlot (O(1))", () => {
    const email = { value: "" };
    const config: AnyConfigNode = { email };
    const nodeState = makeNodeState([[email, "old@test.com"]]);

    const cache = buildValuesCache(config, nodeState);
    expect(cache.values.email).toBe("old@test.com");

    updateValuesCacheEntry(cache, email, "new@test.com");
    expect(cache.values.email).toBe("new@test.com");
  });

  it("обновляет вложенные значения", () => {
    const street = { value: "" };
    const address: AnyConfigNode = { street };
    const config: AnyConfigNode = { address };
    const nodeState = makeNodeState([[street, "Baker St"]]);

    const cache = buildValuesCache(config, nodeState);
    updateValuesCacheEntry(cache, street, "Wall St");

    expect((cache.values.address as Record<string, unknown>).street).toBe("Wall St");
  });

  it("не падает для узла без слота", () => {
    const unknown = { value: "" };
    const config: AnyConfigNode = {};
    const nodeState = new WeakMap<object, FieldState>();

    const cache = buildValuesCache(config, nodeState);
    // Shouldn't throw
    updateValuesCacheEntry(cache, unknown, "test");
    expect(cache.values).toEqual({});
  });
});
