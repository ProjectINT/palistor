import { describe, it, expect, vi } from "vitest";
import { findOnChangeAncestors } from "./findOnChangeAncestors";
import { computeFieldKey } from "./computeFieldKey";
import { Palistor } from "../store/palistor";
import type { AnyConfigNode } from "../store/types";

// ─── OnChangePipeline (через Palistor) ───────────────────────────────────────

describe("OnChangePipeline.fire", () => {
  it("не вызывает onChange если нет предков с onChange", async () => {
    const fieldNode: AnyConfigNode = { value: "" };
    const root: AnyConfigNode = { field: fieldNode };
    const store = new Palistor({ config: root });
    const notifySpy = vi.spyOn(store, "notifyChanged");
    const callsBefore = notifySpy.mock.calls.length;

    store.onChangePipeline.fire(fieldNode, "new", "old");

    await Promise.resolve();
    expect(notifySpy.mock.calls.length).toBe(callsBefore);
  });

  it("вызывает onChange предка с правильными аргументами", async () => {
    const fieldNode: AnyConfigNode = { value: "" };
    const onChange = vi.fn().mockResolvedValue(null);
    const root: AnyConfigNode = { field: fieldNode, onChange };
    const store = new Palistor({ config: root });

    store.onChangePipeline.fire(fieldNode, "new", "old");

    await new Promise((r) => setTimeout(r, 0));
    expect(onChange).toHaveBeenCalledWith({
      fieldKey: "field",
      newValue: "new",
      previousValue: "old",
      allValues: store.values.values,
    });
  });

  it("применяет патч, возвращённый onChange", async () => {
    const fieldNode: AnyConfigNode = { value: "" };
    const otherNode: AnyConfigNode = { value: "" };
    const onChange = vi.fn().mockResolvedValue({ other: "patched" });
    const root: AnyConfigNode = { field: fieldNode, other: otherNode, onChange };
    const store = new Palistor({ config: root });
    const notifySpy = vi.spyOn(store, "notifyChanged");

    store.onChangePipeline.fire(fieldNode, "new", "old");

    await new Promise((r) => setTimeout(r, 0));
    expect(notifySpy).toHaveBeenCalled();
  });

  it("глотает исключение из onChange, не ронит pipeline", async () => {
    const fieldNode: AnyConfigNode = { value: "" };
    const onChange = vi.fn().mockRejectedValue(new Error("boom"));
    const root: AnyConfigNode = { field: fieldNode, onChange };
    const store = new Palistor({ config: root });
    const notifySpy = vi.spyOn(store, "notifyChanged");

    expect(() => store.onChangePipeline.fire(fieldNode, "x", "")).not.toThrow();

    await new Promise((r) => setTimeout(r, 0));
    // notifyChanged from onChange patch should NOT have been called (error swallowed)
  });
});

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


