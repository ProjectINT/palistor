import { describe, it, expect, vi } from "vitest";
import { writeValue } from "./writePipeline";
import type { FieldState } from "../compute/index";
import type { AnyConfigNode } from "../store/types";
import { buildValuesCache } from "../valuesCache/valuesCache";

// ─── Хелперы ─────────────────────────────────────────────────────────────────

function makeState(value: unknown): FieldState {
  return { value, isVisible: true, isRequired: false, isDisabled: false, isReadOnly: false };
}

function makeNodeState(entries: Array<[object, FieldState]>): WeakMap<object, FieldState> {
  const map = new WeakMap<object, FieldState>();
  for (const [node, state] of entries) map.set(node, state);
  return map;
}

// ─── writeValue (интеграция pipeline) ────────────────────────────────────────

describe("writeValue", () => {
  it("возвращает null если узел не зарегистрирован", () => {
    const node: AnyConfigNode = { value: "" };
    const root: AnyConfigNode = { field: node };
    const cache = buildValuesCache(root, new WeakMap());

    const result = writeValue(node, "test", {
      rootConfig: root,
      nodeState: new WeakMap(),
      recomputeAll: () => new Set(),
      valuesCache: cache,
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
    const cache = buildValuesCache(root, nodeState);

    const result = writeValue(node, "42", {
      rootConfig: root,
      nodeState,
      recomputeAll,
      valuesCache: cache,
    });

    expect(nodeState.get(node)!.value).toBe(42);
    expect(recomputeAll).toHaveBeenCalledOnce();
    expect(result!.changed.has(node)).toBe(true);
  });

  it("setter-ветка: патчит зависимые узлы И записывает текущий", () => {
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
    const cache = buildValuesCache(root, nodeState);

    const result = writeValue(node, "b", {
      rootConfig: root,
      nodeState,
      recomputeAll: () => new Set(),
      valuesCache: cache,
    });

    expect(result!.changed.has(node)).toBe(true);
    expect(result!.changed.has(targetNode)).toBe(true);
    expect(nodeState.get(node)!.value).toBe("b");
    expect(nodeState.get(targetNode)!.value).toBe("new");
  });

  it("возвращает skipped: true если значение не изменилось", () => {
    const node: AnyConfigNode = { value: "hello" };
    const root: AnyConfigNode = { field: node };
    const nodeState = makeNodeState([[node, makeState("hello")]]);
    const recomputeAll = vi.fn(() => new Set<object>());
    const cache = buildValuesCache(root, nodeState);

    const result = writeValue(node, "hello", {
      rootConfig: root,
      nodeState,
      recomputeAll,
      valuesCache: cache,
    });

    expect(result!.skipped).toBe(true);
    expect(result!.changed.size).toBe(0);
    expect(recomputeAll).not.toHaveBeenCalled();
  });

  it("возвращает skipped если значение совпадает после форматирования", () => {
    const node: AnyConfigNode = {
      value: 42,
      formatter: (v: unknown) => Number(v) || 0,
    };
    const root: AnyConfigNode = { amount: node };
    const nodeState = makeNodeState([[node, makeState(42)]]);
    const recomputeAll = vi.fn(() => new Set<object>());
    const cache = buildValuesCache(root, nodeState);

    const result = writeValue(node, "42", {
      rootConfig: root,
      nodeState,
      recomputeAll,
      valuesCache: cache,
    });

    expect(result!.skipped).toBe(true);
    expect(recomputeAll).not.toHaveBeenCalled();
  });

  it("не пропускает запись если значение отличается", () => {
    const node: AnyConfigNode = { value: "hello" };
    const root: AnyConfigNode = { field: node };
    const nodeState = makeNodeState([[node, makeState("hello")]]);
    const recomputeAll = vi.fn(() => new Set<object>());
    const cache = buildValuesCache(root, nodeState);

    const result = writeValue(node, "world", {
      rootConfig: root,
      nodeState,
      recomputeAll,
      valuesCache: cache,
    });

    expect(result!.skipped).toBeUndefined();
    expect(result!.changed.has(node)).toBe(true);
    expect(recomputeAll).toHaveBeenCalledOnce();
  });

  it("корректно сравнивает NaN через Object.is", () => {
    const node: AnyConfigNode = { value: NaN };
    const root: AnyConfigNode = { field: node };
    const nodeState = makeNodeState([[node, makeState(NaN)]]);
    const recomputeAll = vi.fn(() => new Set<object>());
    const cache = buildValuesCache(root, nodeState);

    const result = writeValue(node, NaN, {
      rootConfig: root,
      nodeState,
      recomputeAll,
      valuesCache: cache,
    });

    expect(result!.skipped).toBe(true);
    expect(recomputeAll).not.toHaveBeenCalled();
  });
});
