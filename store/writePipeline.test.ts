import { describe, it, expect, vi } from "vitest";
import { formatValue, storeValue, runSetter, mergeChanged, writeValue } from "./writePipeline";
import type { FieldState } from "./compute";
import type { AnyConfigNode } from "./collectValues";

// ─── Хелперы ─────────────────────────────────────────────────────────────────

/** Создать минимальный FieldState с заданным value. */
function makeState(value: unknown): FieldState {
  return {
    value,
    isVisible: true,
    isRequired: false,
    isDisabled: false,
    isReadOnly: false,
  };
}

/** Создать nodeState WeakMap с одной парой node → state. */
function makeNodeState(entries: Array<[object, FieldState]>): WeakMap<object, FieldState> {
  const map = new WeakMap<object, FieldState>();
  for (const [node, state] of entries) map.set(node, state);
  return map;
}

// ─── formatValue ─────────────────────────────────────────────────────────────

describe("formatValue", () => {
  it("возвращает значение как есть, если formatter отсутствует", () => {
    const node: AnyConfigNode = { value: "" };
    const root: AnyConfigNode = { field: node };
    const nodeState = makeNodeState([[node, makeState("")]]);

    const result = formatValue("hello", node, root, nodeState);

    expect(result).toBe("hello");
  });

  it("применяет formatter к значению", () => {
    const node: AnyConfigNode = {
      value: 0,
      formatter: (v: unknown) => (typeof v === "string" ? Number(v) || 0 : v),
    };
    const root: AnyConfigNode = { amount: node };
    const nodeState = makeNodeState([[node, makeState(0)]]);

    const result = formatValue("42", node, root, nodeState);

    expect(result).toBe(42);
  });

  it("передаёт текущие значения формы в formatter", () => {
    const other: AnyConfigNode = { value: "USD" };
    const node: AnyConfigNode = {
      value: 0,
      // formatter, который использует значения других полей
      formatter: (v: unknown, vals: any) =>
        vals.currency === "USD" ? Number(v) : Number(v) * 100,
    };
    const root: AnyConfigNode = { amount: node, currency: other };
    const nodeState = makeNodeState([
      [node, makeState(0)],
      [other, makeState("USD")],
    ]);

    expect(formatValue("5", node, root, nodeState)).toBe(5);

    // Меняем currency → formatter должен умножить на 100
    nodeState.set(other, makeState("BTC"));
    expect(formatValue("5", node, root, nodeState)).toBe(500);
  });

  it("не падает если formatter вернёт undefined", () => {
    const node: AnyConfigNode = {
      value: "",
      formatter: () => undefined,
    };
    const root: AnyConfigNode = { field: node };
    const nodeState = makeNodeState([[node, makeState("")]]);

    const result = formatValue("x", node, root, nodeState);

    expect(result).toBeUndefined();
  });
});

// ─── storeValue ──────────────────────────────────────────────────────────────

describe("storeValue", () => {
  it("обновляет value в nodeState иммутабельно", () => {
    const node: AnyConfigNode = { value: "" };
    const originalState = makeState("old");
    const nodeState = makeNodeState([[node, originalState]]);

    const ok = storeValue(node, "new", nodeState);

    expect(ok).toBe(true);
    expect(nodeState.get(node)!.value).toBe("new");
    // Оригинальный state не мутирован — создан новый объект
    expect(originalState.value).toBe("old");
  });

  it("возвращает false если узел не зарегистрирован", () => {
    const node: AnyConfigNode = { value: "" };
    const nodeState = new WeakMap<object, FieldState>();

    const ok = storeValue(node, "test", nodeState);

    expect(ok).toBe(false);
  });

  it("сохраняет остальные поля FieldState без изменений", () => {
    const node: AnyConfigNode = { value: "" };
    const state: FieldState = {
      value: "old",
      label: "Email",
      isVisible: true,
      isRequired: true,
      isDisabled: false,
      isReadOnly: false,
      error: true,
      errorMessage: "required",
    };
    const nodeState = makeNodeState([[node, state]]);

    storeValue(node, "new", nodeState);

    const updated = nodeState.get(node)!;
    expect(updated.value).toBe("new");
    expect(updated.label).toBe("Email");
    expect(updated.isRequired).toBe(true);
    expect(updated.error).toBe(true);
    expect(updated.errorMessage).toBe("required");
  });
});

// ─── runSetter ───────────────────────────────────────────────────────────────

describe("runSetter", () => {
  it("возвращает пустой Set если setter отсутствует", () => {
    const node: AnyConfigNode = { value: "card" };
    const root: AnyConfigNode = { field: node };
    const nodeState = makeNodeState([[node, makeState("card")]]);

    const changed = runSetter(node, "bank", root, nodeState);

    expect(changed.size).toBe(0);
  });

  it("применяет патч от setter к другим полям", () => {
    const targetNode: AnyConfigNode = { value: "4111" };
    const node: AnyConfigNode = {
      value: "card",
      setter: (value: unknown) => {
        if (value === "bank") return { cardNumber: "" };
        return {};
      },
    };
    const root: AnyConfigNode = { paymentType: node, cardNumber: targetNode };
    const nodeState = makeNodeState([
      [node, makeState("card")],
      [targetNode, makeState("4111")],
    ]);

    const changed = runSetter(node, "bank", root, nodeState);

    // cardNumber должен быть сброшен
    expect(nodeState.get(targetNode)!.value).toBe("");
    // changed должен содержать targetNode
    expect(changed.has(targetNode)).toBe(true);
  });

  it("не включает узлы с неизменённым значением в changed", () => {
    const targetNode: AnyConfigNode = { value: "" };
    const node: AnyConfigNode = {
      value: "card",
      setter: () => ({ target: "" }), // то же значение что и было
    };
    const root: AnyConfigNode = { source: node, target: targetNode };
    const nodeState = makeNodeState([
      [node, makeState("card")],
      [targetNode, makeState("")], // уже пустая строка
    ]);

    const changed = runSetter(node, "bank", root, nodeState);

    expect(changed.size).toBe(0);
  });

  it("работает с вложенными патчами", () => {
    const cityNode: AnyConfigNode = { value: "" };
    const zipNode: AnyConfigNode = { value: "" };
    const node: AnyConfigNode = {
      value: "ru",
      setter: (value: unknown) => {
        if (value === "us") return { address: { city: "New York" } };
        return {};
      },
    };
    const root: AnyConfigNode = {
      country: node,
      address: { city: cityNode, zip: zipNode },
    };
    const nodeState = makeNodeState([
      [node, makeState("ru")],
      [cityNode, makeState("")],
      [zipNode, makeState("")],
    ]);

    const changed = runSetter(node, "us", root, nodeState);

    expect(nodeState.get(cityNode)!.value).toBe("New York");
    expect(nodeState.get(zipNode)!.value).toBe(""); // не тронут
    expect(changed.has(cityNode)).toBe(true);
    expect(changed.has(zipNode)).toBe(false);
  });

  it("передаёт текущие значения в setter", () => {
    const otherNode: AnyConfigNode = { value: "active" };
    const setterSpy = vi.fn(() => ({}));
    const node: AnyConfigNode = {
      value: "x",
      setter: setterSpy,
    };
    const root: AnyConfigNode = { source: node, status: otherNode };
    const nodeState = makeNodeState([
      [node, makeState("x")],
      [otherNode, makeState("active")],
    ]);

    runSetter(node, "y", root, nodeState);

    // Второй аргумент setter — snapshot значений, третий — previousValue
    expect(setterSpy).toHaveBeenCalledWith("y", { source: "x", status: "active" }, undefined);
  });
});

// ─── mergeChanged ────────────────────────────────────────────────────────────

describe("mergeChanged", () => {
  it("всегда включает текущий узел", () => {
    const node = {};
    const result = mergeChanged(node, new Set(), new Set());

    expect(result.has(node)).toBe(true);
    expect(result.size).toBe(1);
  });

  it("объединяет patched и recomputed узлы", () => {
    const node = {};
    const patched1 = {};
    const patched2 = {};
    const recomputed1 = {};

    const result = mergeChanged(
      node,
      new Set([patched1, patched2]),
      new Set([recomputed1]),
    );

    expect(result.size).toBe(4);
    expect(result.has(node)).toBe(true);
    expect(result.has(patched1)).toBe(true);
    expect(result.has(patched2)).toBe(true);
    expect(result.has(recomputed1)).toBe(true);
  });

  it("дедуплицирует пересекающиеся узлы", () => {
    const node = {};
    const shared = {};

    const result = mergeChanged(
      node,
      new Set([shared]),
      new Set([shared, node]),
    );

    // node + shared = 2, не 4
    expect(result.size).toBe(2);
  });
});

// ─── writeValue (интеграция pipeline) ────────────────────────────────────────

describe("writeValue", () => {
  it("возвращает null если узел не зарегистрирован", () => {
    const node: AnyConfigNode = { value: "" };
    const root: AnyConfigNode = { field: node };

    const result = writeValue(node, "test", {
      rootConfig: root,
      nodeState: new WeakMap(),
      recomputeAll: () => new Set(),
    });

    expect(result).toBeNull();
  });

  it("выполняет полный цикл: format → store → recompute", () => {
    const node: AnyConfigNode = {
      value: 0,
      formatter: (v: unknown) => Number(v) || 0,
    };
    const root: AnyConfigNode = { amount: node };
    const nodeState = makeNodeState([[node, makeState(0)]]);
    const recomputeAll = vi.fn(() => new Set<object>());

    const result = writeValue(node, "42", {
      rootConfig: root,
      nodeState,
      recomputeAll,
    });

    // Значение отформатировано и записано
    expect(nodeState.get(node)!.value).toBe(42);
    // recomputeAll вызван
    expect(recomputeAll).toHaveBeenCalledOnce();
    // Текущий узел в changed
    expect(result!.changed.has(node)).toBe(true);
  });

  it("включает запатченные узлы в changed", () => {
    const targetNode: AnyConfigNode = { value: "old" };
    const node: AnyConfigNode = {
      value: "a",
      setter: () => ({ target: "new" }),
    };
    const root: AnyConfigNode = { source: node, target: targetNode };
    const nodeState = makeNodeState([
      [node, makeState("a")],
      [targetNode, makeState("old")],
    ]);

    const result = writeValue(node, "b", {
      rootConfig: root,
      nodeState,
      recomputeAll: () => new Set(),
    });

    expect(result!.changed.has(node)).toBe(true);
    expect(result!.changed.has(targetNode)).toBe(true);
    expect(nodeState.get(targetNode)!.value).toBe("new");
  });

  it("возвращает skipped: true если значение не изменилось", () => {
    const node: AnyConfigNode = { value: "hello" };
    const root: AnyConfigNode = { field: node };
    const nodeState = makeNodeState([[node, makeState("hello")]]);
    const recomputeAll = vi.fn(() => new Set<object>());

    const result = writeValue(node, "hello", {
      rootConfig: root,
      nodeState,
      recomputeAll,
    });

    expect(result).not.toBeNull();
    expect(result!.skipped).toBe(true);
    expect(result!.changed.size).toBe(0);
    // recomputeAll НЕ вызван — pipeline прерван
    expect(recomputeAll).not.toHaveBeenCalled();
    // Значение осталось прежним
    expect(nodeState.get(node)!.value).toBe("hello");
  });

  it("возвращает skipped: true если значение совпадает после форматирования", () => {
    const node: AnyConfigNode = {
      value: 42,
      formatter: (v: unknown) => Number(v) || 0,
    };
    const root: AnyConfigNode = { amount: node };
    const nodeState = makeNodeState([[node, makeState(42)]]);
    const recomputeAll = vi.fn(() => new Set<object>());

    // Передаём строку "42", formatter вернёт число 42 — совпадение
    const result = writeValue(node, "42", {
      rootConfig: root,
      nodeState,
      recomputeAll,
    });

    expect(result!.skipped).toBe(true);
    expect(recomputeAll).not.toHaveBeenCalled();
  });

  it("не пропускает запись если значение отличается", () => {
    const node: AnyConfigNode = { value: "hello" };
    const root: AnyConfigNode = { field: node };
    const nodeState = makeNodeState([[node, makeState("hello")]]);
    const recomputeAll = vi.fn(() => new Set<object>());

    const result = writeValue(node, "world", {
      rootConfig: root,
      nodeState,
      recomputeAll,
    });

    expect(result!.skipped).toBeUndefined();
    expect(result!.changed.has(node)).toBe(true);
    expect(recomputeAll).toHaveBeenCalledOnce();
  });

  it("различает NaN корректно через Object.is", () => {
    const node: AnyConfigNode = { value: NaN };
    const root: AnyConfigNode = { field: node };
    const nodeState = makeNodeState([[node, makeState(NaN)]]);
    const recomputeAll = vi.fn(() => new Set<object>());

    const result = writeValue(node, NaN, {
      rootConfig: root,
      nodeState,
      recomputeAll,
    });

    // NaN === NaN через Object.is → skipped
    expect(result!.skipped).toBe(true);
    expect(recomputeAll).not.toHaveBeenCalled();
  });
});
