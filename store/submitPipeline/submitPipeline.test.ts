import { describe, it, expect, vi } from "vitest";
import type { AnyConfigNode } from "../types";
import type { FieldState } from "../compute/index";
import { getSubValues } from "./getSubValues";
import { collectLeafStates } from "./collectLeafStates";
import { applyLeafBeforeSubmit } from "./applyLeafBeforeSubmit";
import { executeSubmit } from "./submitPipeline";
import type { SubmitDeps } from "./types";

// ─── Хелперы ─────────────────────────────────────────────────────────────────

function makeState(overrides: Partial<FieldState> = {}): FieldState {
  return {
    value: "",
    isVisible: true,
    isRequired: false,
    isDisabled: false,
    isReadOnly: false,
    ...overrides,
  };
}

function makeCache(values: Record<string, unknown>) {
  return {
    values,
    nodeSlot: new WeakMap(),
  };
}

function makeNodeState(entries: Array<[object, FieldState]>): WeakMap<object, FieldState> {
  const map = new WeakMap<object, FieldState>();
  for (const [node, state] of entries) map.set(node, state);
  return map;
}

// ─── getSubValues ─────────────────────────────────────────────────────────────

describe("getSubValues", () => {
  it("возвращает весь кеш для корневого узла", () => {
    const root: AnyConfigNode = { name: { value: "" } };
    const cache = makeCache({ name: "Alice" });
    const nodePaths = new WeakMap<object, string>();

    const result = getSubValues(cache, root, root, nodePaths);

    expect(result).toEqual({ name: "Alice" });
  });

  it("возвращает поддерево по пути для вложенной группы", () => {
    const sub: AnyConfigNode = { city: { value: "" } };
    const root: AnyConfigNode = { address: sub };
    const cache = makeCache({ address: { city: "Moscow" } });
    const nodePaths = new WeakMap<object, string>([[sub, "address"]]);

    const result = getSubValues(cache, sub, root, nodePaths);

    expect(result).toEqual({ city: "Moscow" });
  });

  it("возвращает snapshot — мутации не влияют на кеш", () => {
    const root: AnyConfigNode = { x: { value: "" } };
    const cache = makeCache({ x: 1 });
    const nodePaths = new WeakMap<object, string>();

    const result = getSubValues(cache, root, root, nodePaths);
    result["x"] = 999;

    expect(cache.values["x"]).toBe(1);
  });

  it("возвращает пустой объект если путь не найден в кеше", () => {
    const sub: AnyConfigNode = { field: { value: "" } };
    const root: AnyConfigNode = { nested: sub };
    const cache = makeCache({});
    const nodePaths = new WeakMap<object, string>([[sub, "missing.path"]]);

    const result = getSubValues(cache, sub, root, nodePaths);

    expect(result).toEqual({});
  });
});

// ─── collectLeafStates ───────────────────────────────────────────────────────

describe("collectLeafStates", () => {
  it("собирает листовые узлы с их путями", () => {
    const nameNode: AnyConfigNode = { value: "" };
    const ageNode: AnyConfigNode = { value: 0 };
    const form: AnyConfigNode = { name: nameNode, age: ageNode };
    const nodeState = makeNodeState([
      [nameNode, makeState({ value: "Bob" })],
      [ageNode, makeState({ value: 30 })],
    ]);

    const leaves = collectLeafStates(form, nodeState);

    expect(leaves).toHaveLength(2);
    expect(leaves.find((l) => l.path === "name")?.state.value).toBe("Bob");
    expect(leaves.find((l) => l.path === "age")?.state.value).toBe(30);
  });

  it("рекурсивно обходит вложенные группы с составными путями", () => {
    const cityNode: AnyConfigNode = { value: "" };
    const group: AnyConfigNode = { address: { city: cityNode } };
    const nodeState = makeNodeState([[cityNode, makeState({ value: "SPb" })]]);

    const leaves = collectLeafStates(group, nodeState);

    expect(leaves).toHaveLength(1);
    expect(leaves[0].path).toBe("address.city");
  });

  it("пропускает узел если нет state в nodeState", () => {
    const leaf: AnyConfigNode = { value: "" };
    const form: AnyConfigNode = { field: leaf };
    const nodeState = new WeakMap<object, FieldState>();

    const leaves = collectLeafStates(form, nodeState);

    expect(leaves).toHaveLength(0);
  });
});

// ─── applyLeafBeforeSubmit ───────────────────────────────────────────────────

describe("applyLeafBeforeSubmit", () => {
  it("применяет beforeSubmit трансформацию к листу", () => {
    const leaf: AnyConfigNode = {
      value: "",
      beforeSubmit: (v: unknown) => String(v).trim(),
    };
    const form: AnyConfigNode = { name: leaf };

    const result = applyLeafBeforeSubmit(form, { name: "  Alice  " });

    expect(result.name).toBe("Alice");
  });

  it("передаёт текущий snapshot как второй аргумент beforeSubmit", () => {
    const transformFn = vi.fn((v: unknown) => v);
    const leaf: AnyConfigNode = { value: "", beforeSubmit: transformFn };
    const form: AnyConfigNode = { field: leaf };
    const values = { field: "val" };

    applyLeafBeforeSubmit(form, values);

    expect(transformFn).toHaveBeenCalledWith("val", values);
  });

  it("не трогает листы без beforeSubmit", () => {
    const leaf: AnyConfigNode = { value: "" };
    const form: AnyConfigNode = { name: leaf };

    const result = applyLeafBeforeSubmit(form, { name: "Bob" });

    expect(result.name).toBe("Bob");
  });

  it("рекурсивно обходит вложенные группы", () => {
    const leaf: AnyConfigNode = {
      value: "",
      beforeSubmit: (v: unknown) => Number(v) * 2,
    };
    const form: AnyConfigNode = { nested: { score: leaf } };

    const result = applyLeafBeforeSubmit(form, { nested: { score: 5 } });

    expect((result.nested as Record<string, unknown>)["score"]).toBe(10);
  });
});

// ─── executeSubmit ────────────────────────────────────────────────────────────

function makeBaseDeps(overrides: Partial<SubmitDeps> = {}): SubmitDeps {
  const groupNode: AnyConfigNode = {};
  return {
    nodeState: new WeakMap([[groupNode, makeState()]]),
    recomputeAll: vi.fn(() => new Set<object>()),
    notifyChanged: vi.fn(),
    resetNode: vi.fn(),
    valuesCache: makeCache({}),
    nodePaths: new WeakMap(),
    rootConfig: groupNode,
    ...overrides,
  };
}

describe("executeSubmit", () => {
  it("возвращает success:true если нет ошибок и вызывает onSubmit", async () => {
    const groupNode: AnyConfigNode = { onSubmit: vi.fn().mockResolvedValue("ok") };
    const deps = makeBaseDeps({
      nodeState: new WeakMap([[groupNode, makeState()]]),
      rootConfig: groupNode,
      valuesCache: makeCache({ x: 1 }),
    });

    const result = await executeSubmit(groupNode, deps);

    expect(result).toEqual({ success: true, result: "ok" });
    expect(groupNode.onSubmit).toHaveBeenCalledWith({ x: 1 });
  });

  it("возвращает success:false при наличии ошибок валидации", async () => {
    const leafNode: AnyConfigNode = { value: "" };
    const groupNode: AnyConfigNode = { field: leafNode };
    const leafState = makeState({ isInvalid: true, errorMessage: "Обязательное поле" });
    const nodeState = new WeakMap<object, FieldState>([
      [groupNode, makeState()],
      [leafNode, leafState],
    ]);
    const deps = makeBaseDeps({
      nodeState,
      rootConfig: groupNode,
      recomputeAll: vi.fn(() => new Set<object>()),
    });

    const result = await executeSubmit(groupNode, deps);

    expect(result).toEqual({
      success: false,
      errors: [{ path: "field", message: "Обязательное поле" }],
    });
  });

  it("вызывает clearPersist при успехе", async () => {
    const groupNode: AnyConfigNode = {};
    const clearPersist = vi.fn().mockResolvedValue(undefined);
    const deps = makeBaseDeps({
      nodeState: new WeakMap([[groupNode, makeState()]]),
      rootConfig: groupNode,
      clearPersist,
    });

    await executeSubmit(groupNode, deps);

    expect(clearPersist).toHaveBeenCalledOnce();
  });

  it("устанавливает submitting=false в finally даже при ошибке onSubmit", async () => {
    const groupNode: AnyConfigNode = {
      onSubmit: vi.fn().mockRejectedValue(new Error("server error")),
    };
    const nodeState = new WeakMap<object, FieldState>([[groupNode, makeState()]]);
    const deps = makeBaseDeps({
      nodeState,
      rootConfig: groupNode,
    });

    await expect(executeSubmit(groupNode, deps)).rejects.toThrow("server error");

    expect(nodeState.get(groupNode)?.submitting).toBe(false);
  });

  it("вызывает afterSubmit с результатом и reset-экшеном", async () => {
    const afterSubmit = vi.fn();
    const groupNode: AnyConfigNode = {
      onSubmit: vi.fn().mockResolvedValue(42),
      afterSubmit,
    };
    const nodeState = new WeakMap<object, FieldState>([[groupNode, makeState()]]);
    const deps = makeBaseDeps({
      nodeState,
      rootConfig: groupNode,
    });

    await executeSubmit(groupNode, deps);

    expect(afterSubmit).toHaveBeenCalledWith(42, { reset: expect.any(Function) });
  });
});
