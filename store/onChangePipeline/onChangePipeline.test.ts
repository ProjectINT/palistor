import { describe, it, expect, vi } from "vitest";
import { findOnChangeAncestors } from "./findOnChangeAncestors";
import { computeFieldKey } from "./computeFieldKey";
import { fireOnChange, applyOnChangeResult } from "./onChangePipeline";
import type { AnyConfigNode } from "../types";
import type { FieldState } from "../compute/index";
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

// ─── computeFieldKey ─────────────────────────────────────────────────────────

describe("computeFieldKey", () => {
  it("возвращает nodePath если ancestorPath пустой (корневой предок)", () => {
    expect(computeFieldKey("name", "")).toBe("name");
  });

  it("вычисляет относительный путь при вложенном предке", () => {
    expect(computeFieldKey("form.address.city", "form")).toBe("address.city");
  });

  it("однословный путь относительно прямого родителя", () => {
    expect(computeFieldKey("form.name", "form")).toBe("name");
  });
});

// ─── findOnChangeAncestors ───────────────────────────────────────────────────

describe("findOnChangeAncestors", () => {
  it("возвращает пустой массив если нет родителей", () => {
    const node = {};
    const parents = new WeakMap<object, object>();
    expect(findOnChangeAncestors(node, parents)).toEqual([]);
  });

  it("пропускает родителей без onChange", () => {
    const node = {};
    const parent: AnyConfigNode = { someField: {} };
    const parents = new WeakMap<object, object>([[node, parent]]);
    expect(findOnChangeAncestors(node, parents)).toEqual([]);
  });

  it("собирает родителя с onChange", () => {
    const node = {};
    const parent: AnyConfigNode = { onChange: vi.fn() };
    const parents = new WeakMap<object, object>([[node, parent]]);
    expect(findOnChangeAncestors(node, parents)).toEqual([parent]);
  });

  it("собирает нескольких предков с onChange снизу вверх", () => {
    const node = {};
    const parent: AnyConfigNode = { onChange: vi.fn() };
    const grandparent: AnyConfigNode = { onChange: vi.fn() };
    const root: AnyConfigNode = {};
    const parents = new WeakMap<object, object>([
      [node, parent],
      [parent, grandparent],
      [grandparent, root],
    ]);
    const result = findOnChangeAncestors(node, parents);
    expect(result).toEqual([parent, grandparent]);
  });

  it("пропускает промежуточные узлы без onChange", () => {
    const node = {};
    const parent: AnyConfigNode = {};           // нет onChange
    const grandparent: AnyConfigNode = { onChange: vi.fn() };
    const parents = new WeakMap<object, object>([
      [node, parent],
      [parent, grandparent],
    ]);
    expect(findOnChangeAncestors(node, parents)).toEqual([grandparent]);
  });
});

// ─── applyOnChangeResult ─────────────────────────────────────────────────────

describe("applyOnChangeResult", () => {
  it("ничего не делает при null патче", () => {
    const ancestor: AnyConfigNode = { field: { value: "" } };
    const nodeState = makeNodeState([[ancestor.field as object, makeState("")]]);
    const recomputeAll = vi.fn(() => new Set<object>());
    const notifyChanged = vi.fn();
    const cache = buildValuesCache(ancestor, nodeState);

    applyOnChangeResult(null, ancestor, nodeState, recomputeAll, notifyChanged, cache);

    expect(recomputeAll).not.toHaveBeenCalled();
    expect(notifyChanged).not.toHaveBeenCalled();
  });

  it("ничего не делает при пустом объекте-патче", () => {
    const ancestor: AnyConfigNode = { field: { value: "" } };
    const nodeState = makeNodeState([[ancestor.field as object, makeState("")]]);
    const recomputeAll = vi.fn(() => new Set<object>());
    const notifyChanged = vi.fn();
    const cache = buildValuesCache(ancestor, nodeState);

    applyOnChangeResult({}, ancestor, nodeState, recomputeAll, notifyChanged, cache);

    expect(notifyChanged).not.toHaveBeenCalled();
  });

  it("применяет валидный патч и нотифицирует", () => {
    const fieldNode: AnyConfigNode = { value: "old" };
    const ancestor: AnyConfigNode = { field: fieldNode };
    const nodeState = makeNodeState([[fieldNode as object, makeState("old")]]);
    const recomputeAll = vi.fn(() => new Set<object>());
    const notifyChanged = vi.fn();
    const cache = buildValuesCache(ancestor, nodeState);

    applyOnChangeResult({ field: "new" }, ancestor, nodeState, recomputeAll, notifyChanged, cache);

    expect(notifyChanged).toHaveBeenCalledOnce();
  });
});

// ─── fireOnChange ─────────────────────────────────────────────────────────────

describe("fireOnChange", () => {
  it("не вызывает onChange если нет предков с onChange", async () => {
    const fieldNode: AnyConfigNode = { value: "" };
    const root: AnyConfigNode = { field: fieldNode };
    const nodeState = makeNodeState([[fieldNode as object, makeState("")]]);
    const cache = buildValuesCache(root, nodeState);

    const nodePaths = new WeakMap<object, string>([[fieldNode as object, "field"]]);
    const nodeParents = new WeakMap<object, object>([[fieldNode as object, root]]);
    const recomputeAll = vi.fn(() => new Set<object>());
    const notifyChanged = vi.fn();

    fireOnChange(fieldNode, "new", "old", {
      rootConfig: root,
      nodeState,
      nodePaths,
      nodeParents,
      recomputeAll,
      notifyChanged,
      valuesCache: cache,
    });

    // Даём очереди микрозадач отработать
    await Promise.resolve();
    expect(notifyChanged).not.toHaveBeenCalled();
  });

  it("вызывает onChange предка с правильными аргументами", async () => {
    const fieldNode: AnyConfigNode = { value: "" };
    const onChange = vi.fn().mockResolvedValue(null);
    const root: AnyConfigNode = { field: fieldNode, onChange };
    const nodeState = makeNodeState([[fieldNode as object, makeState("old")]]);
    const cache = buildValuesCache(root, nodeState);

    const nodePaths = new WeakMap<object, string>([
      [fieldNode as object, "field"],
      [root as object, ""],
    ]);
    const nodeParents = new WeakMap<object, object>([[fieldNode as object, root]]);
    const recomputeAll = vi.fn(() => new Set<object>());
    const notifyChanged = vi.fn();

    fireOnChange(fieldNode, "new", "old", {
      rootConfig: root,
      nodeState,
      nodePaths,
      nodeParents,
      recomputeAll,
      notifyChanged,
      valuesCache: cache,
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(onChange).toHaveBeenCalledWith({
      fieldKey: "field",
      newValue: "new",
      previousValue: "old",
      allValues: cache.values,
    });
  });

  it("применяет патч, возвращённый onChange", async () => {
    const fieldNode: AnyConfigNode = { value: "" };
    const otherNode: AnyConfigNode = { value: "" };
    const onChange = vi.fn().mockResolvedValue({ other: "patched" });
    const root: AnyConfigNode = { field: fieldNode, other: otherNode, onChange };

    const nodeState = makeNodeState([
      [fieldNode as object, makeState("old")],
      [otherNode as object, makeState("")],
    ]);
    const cache = buildValuesCache(root, nodeState);

    const nodePaths = new WeakMap<object, string>([
      [fieldNode as object, "field"],
      [root as object, ""],
    ]);
    const nodeParents = new WeakMap<object, object>([[fieldNode as object, root]]);
    const recomputeAll = vi.fn(() => new Set<object>());
    const notifyChanged = vi.fn();

    fireOnChange(fieldNode, "new", "old", {
      rootConfig: root,
      nodeState,
      nodePaths,
      nodeParents,
      recomputeAll,
      notifyChanged,
      valuesCache: cache,
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(notifyChanged).toHaveBeenCalledOnce();
  });

  it("глотает исключение из onChange, не ронит pipeline", async () => {
    const fieldNode: AnyConfigNode = { value: "" };
    const onChange = vi.fn().mockRejectedValue(new Error("boom"));
    const root: AnyConfigNode = { field: fieldNode, onChange };
    const nodeState = makeNodeState([[fieldNode as object, makeState("")]]);
    const cache = buildValuesCache(root, nodeState);

    const nodePaths = new WeakMap<object, string>([
      [fieldNode as object, "field"],
      [root as object, ""],
    ]);
    const nodeParents = new WeakMap<object, object>([[fieldNode as object, root]]);
    const recomputeAll = vi.fn(() => new Set<object>());
    const notifyChanged = vi.fn();

    expect(() =>
      fireOnChange(fieldNode, "x", "", {
        rootConfig: root,
        nodeState,
        nodePaths,
        nodeParents,
        recomputeAll,
        notifyChanged,
        valuesCache: cache,
      }),
    ).not.toThrow();

    await new Promise((r) => setTimeout(r, 0));
    expect(notifyChanged).not.toHaveBeenCalled();
  });
});
