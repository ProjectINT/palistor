import { describe, it, expect, vi } from "vitest";
import { findOnChangeNodes } from "./findOnChangeAncestors";
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

  it("self-reference: возвращает последний сегмент для вложенного leaf", () => {
    expect(computeFieldKey("form.country", "form.country")).toBe("country");
  });

  it("self-reference: возвращает имя для корневого leaf", () => {
    expect(computeFieldKey("name", "name")).toBe("name");
  });
});

// ─── findOnChangeNodes ───────────────────────────────────────────────────────

describe("findOnChangeNodes", () => {
  it("возвращает пустой массив если нет родителей и нет onChange на самом узле", () => {
    const node = {};
    const parents = new WeakMap<object, object>();
    expect(findOnChangeNodes(node, parents)).toEqual([]);
  });

  it("пропускает родителей без onChange", () => {
    const node = {};
    const parent: AnyConfigNode = { someField: {} };
    const parents = new WeakMap<object, object>([[node, parent]]);
    expect(findOnChangeNodes(node, parents)).toEqual([]);
  });

  it("собирает родителя с onChange", () => {
    const node = {};
    const parent: AnyConfigNode = { onChange: vi.fn() };
    const parents = new WeakMap<object, object>([[node, parent]]);
    expect(findOnChangeNodes(node, parents)).toEqual([parent]);
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
    const result = findOnChangeNodes(node, parents);
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
    expect(findOnChangeNodes(node, parents)).toEqual([grandparent]);
  });

  it("включает сам узел если у него есть onChange", () => {
    const node: AnyConfigNode = { value: "", onChange: vi.fn() };
    const parent: AnyConfigNode = { onChange: vi.fn() };
    const parents = new WeakMap<object, object>([[node, parent]]);
    const result = findOnChangeNodes(node, parents);
    expect(result).toEqual([node, parent]);
  });

  it("включает только сам узел если у предков нет onChange", () => {
    const node: AnyConfigNode = { value: "", onChange: vi.fn() };
    const parent: AnyConfigNode = {};
    const parents = new WeakMap<object, object>([[node, parent]]);
    expect(findOnChangeNodes(node, parents)).toEqual([node]);
  });
});

// ─── Leaf onChange — интеграционные тесты (через proxy) ─────────────────────

describe("Leaf onChange (integration via proxy)", () => {
  function flushPromises() {
    return new Promise<void>((r) => setTimeout(r, 0));
  }

  it("3.1: вызывается с { fieldKey, newValue, previousValue, allValues }", async () => {
    const onChangeSpy = vi.fn();
    const config = { name: { value: "Alice", onChange: onChangeSpy } };
    const store = new Palistor({ config });
    store.proxy.name.value = "Bob";
    await flushPromises();
    expect(onChangeSpy).toHaveBeenCalledWith({
      fieldKey: "name",
      newValue: "Bob",
      previousValue: "Alice",
      allValues: expect.objectContaining({ name: "Bob" }),
    });
  });

  it("3.2: patch из leaf onChange применяется к parent group", async () => {
    const config = {
      country: {
        value: "US",
        onChange: async ({ newValue }: { newValue: unknown }) => {
          return { city: newValue === "RU" ? "Moscow" : "New York" };
        },
      },
      city: { value: "" },
    };
    const store = new Palistor({ config });
    store.proxy.country.value = "RU";
    await flushPromises();
    expect(store.proxy.city.value).toBe("Moscow");
  });

  it("3.3: ошибка в leaf onChange не блокирует запись значения", async () => {
    const config = {
      toggle: { value: false, onChange: () => { throw new Error("boom"); } },
    };
    const store = new Palistor({ config });
    store.proxy.toggle.value = true;
    await flushPromises();
    expect(store.proxy.toggle.value).toBe(true);
  });

  it("3.4: leaf onChange и parent group onChange оба вызываются", async () => {
    const leafSpy = vi.fn();
    const groupSpy = vi.fn();
    const config = {
      name: { value: "", onChange: leafSpy },
      onChange: groupSpy,
    };
    const store = new Palistor({ config });
    store.proxy.name.value = "test";
    await flushPromises();
    expect(leafSpy).toHaveBeenCalledWith(expect.objectContaining({ fieldKey: "name" }));
    expect(groupSpy).toHaveBeenCalledWith(expect.objectContaining({ fieldKey: "name" }));
  });

  it("3.5: async patch из leaf onChange применяется после резолва промиса", async () => {
    const config = {
      search: {
        value: "",
        onChange: async ({ newValue }: { newValue: unknown }) => {
          return { results: `found:${newValue}` };
        },
      },
      results: { value: "" },
    };
    const store = new Palistor({ config });
    store.proxy.search.value = "hello";
    await flushPromises();
    expect(store.proxy.results.value).toBe("found:hello");
  });

  it("3.6: leaf onChange не вызывается если значение не изменилось", async () => {
    const spy = vi.fn();
    const config = { name: { value: "same", onChange: spy } };
    const store = new Palistor({ config });
    store.proxy.name.value = "same";
    await flushPromises();
    expect(spy).not.toHaveBeenCalled();
  });
});

