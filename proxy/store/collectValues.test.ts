import { describe, it, expect } from "vitest";
import { collectValues, type AnyConfigNode } from "./collectValues";
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

// ─── Тесты ───────────────────────────────────────────────────────────────────

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

    expect(collectValues(config, nodeState)).toEqual({
      home: { address: { street: "Baker St", city: "London" } },
    });
  });

  it("возвращает '' для листового поля без записи в nodeState", () => {
    const email = { value: "" };
    const config: AnyConfigNode = { email };
    const nodeState = new WeakMap<object, FieldState>(); // нет записи для email

    expect(collectValues(config, nodeState)).toEqual({ email: "" });
  });

  it("пропускает служебные ключи CONFIG_PROPS (value, label, validate, formatter…)", () => {
    // Листовые узлы содержат value, label, validate — они не должны
    // попасть в results как отдельные поля, только сам узел целиком
    const email = { value: "", label: "Email", validate: () => undefined };
    const config: AnyConfigNode = { email };
    const nodeState = makeNodeState([[email, "test@test.com"]]);

    const result = collectValues(config, nodeState);

    // Результат содержит только "email", а не "value", "label", "validate"
    expect(result).toEqual({ email: "test@test.com" });
    expect(result).not.toHaveProperty("value");
    expect(result).not.toHaveProperty("label");
    expect(result).not.toHaveProperty("validate");
  });

  it("пропускает служебные ключи групп (isVisible, isRequired на GroupConfigNode)", () => {
    const number = { value: "" };
    // Группа с isVisible — isVisible не должна попасть в values
    const passport: AnyConfigNode = {
      isVisible: () => true,
      number,
    };
    const config: AnyConfigNode = { passport };
    const nodeState = makeNodeState([[number, "XY999"]]);

    const result = collectValues(config, nodeState);

    expect(result).toEqual({ passport: { number: "XY999" } });
    expect((result.passport as Record<string, unknown>)).not.toHaveProperty("isVisible");
  });

  it("пропускает примитивные (не-объектные) значения ключей", () => {
    // Конфиг с ключом, значение которого — примитив (не узел дерева).
    // Такого быть не должно в валидном конфиге, но функция должна устоять.
    const email = { value: "" };
    const config: AnyConfigNode = {
      email,
      someString: "unexpected" as unknown as AnyConfigNode,
      someNumber: 42 as unknown as AnyConfigNode,
      nullValue: null as unknown as AnyConfigNode,
    };
    const nodeState = makeNodeState([[email, "hi@example.com"]]);

    expect(collectValues(config, nodeState)).toEqual({ email: "hi@example.com" });
  });

  it("корректно возвращает falsy-значения value (0, false, null)", () => {
    const count = { value: 0 };
    const checked = { value: false };
    const config: AnyConfigNode = { count, checked };
    const nodeState = makeNodeState([
      [count, 0],
      [checked, false],
    ]);

    expect(collectValues(config, nodeState)).toEqual({ count: 0, checked: false });
  });
});
