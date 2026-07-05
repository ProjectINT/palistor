import { describe, it, expect, vi } from "vitest";
import { findOnChangeNodes } from "./findOnChangeAncestors";
import { computeFieldKey } from "./computeFieldKey";
import { Palistor } from "../store/palistor";
import type { AnyConfigNode } from "../store/types";

// ─── OnChangePipeline (via Palistor) ─────────────────────────────────────────

describe("OnChangePipeline.fire", () => {
  it("does not call onChange when no ancestor has onChange", async () => {
    const fieldNode: AnyConfigNode = { value: "" };
    const root: AnyConfigNode = { field: fieldNode };
    const store = new Palistor({ config: root });
    const notifySpy = vi.spyOn(store, "notifyChanged");
    const callsBefore = notifySpy.mock.calls.length;

    store.onChangePipeline.fire(fieldNode, "new", "old");

    await Promise.resolve();
    expect(notifySpy.mock.calls.length).toBe(callsBefore);
  });

  it("calls the ancestor's onChange with the right arguments", async () => {
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

  it("applies the patch returned by onChange", async () => {
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

  it("swallows an onChange exception without crashing the pipeline", async () => {
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
  it("returns nodePath when ancestorPath is empty (root ancestor)", () => {
    expect(computeFieldKey("name", "")).toBe("name");
  });

  it("computes the relative path for a nested ancestor", () => {
    expect(computeFieldKey("form.address.city", "form")).toBe("address.city");
  });

  it("a single-segment path relative to the direct parent", () => {
    expect(computeFieldKey("form.name", "form")).toBe("name");
  });

  it("self-reference: returns the last segment for a nested leaf", () => {
    expect(computeFieldKey("form.country", "form.country")).toBe("country");
  });

  it("self-reference: returns the name for a root-level leaf", () => {
    expect(computeFieldKey("name", "name")).toBe("name");
  });
});

// ─── findOnChangeNodes ───────────────────────────────────────────────────────

describe("findOnChangeNodes", () => {
  it("returns an empty array with no parents and no onChange on the node itself", () => {
    const node = {};
    const parents = new WeakMap<object, object>();
    expect(findOnChangeNodes(node, parents)).toEqual([]);
  });

  it("skips parents without onChange", () => {
    const node = {};
    const parent: AnyConfigNode = { someField: {} };
    const parents = new WeakMap<object, object>([[node, parent]]);
    expect(findOnChangeNodes(node, parents)).toEqual([]);
  });

  it("collects the parent with onChange", () => {
    const node = {};
    const parent: AnyConfigNode = { onChange: vi.fn() };
    const parents = new WeakMap<object, object>([[node, parent]]);
    expect(findOnChangeNodes(node, parents)).toEqual([parent]);
  });

  it("collects several ancestors with onChange bottom-up", () => {
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

  it("skips intermediate nodes without onChange", () => {
    const node = {};
    const parent: AnyConfigNode = {};           // no onChange
    const grandparent: AnyConfigNode = { onChange: vi.fn() };
    const parents = new WeakMap<object, object>([
      [node, parent],
      [parent, grandparent],
    ]);
    expect(findOnChangeNodes(node, parents)).toEqual([grandparent]);
  });

  it("includes the node itself when it has onChange", () => {
    const node: AnyConfigNode = { value: "", onChange: vi.fn() };
    const parent: AnyConfigNode = { onChange: vi.fn() };
    const parents = new WeakMap<object, object>([[node, parent]]);
    const result = findOnChangeNodes(node, parents);
    expect(result).toEqual([node, parent]);
  });

  it("includes only the node itself when the ancestors lack onChange", () => {
    const node: AnyConfigNode = { value: "", onChange: vi.fn() };
    const parent: AnyConfigNode = {};
    const parents = new WeakMap<object, object>([[node, parent]]);
    expect(findOnChangeNodes(node, parents)).toEqual([node]);
  });
});

// ─── Leaf onChange — integration tests (via the proxy) ───────────────────────

describe("Leaf onChange (integration via proxy)", () => {
  function flushPromises() {
    return new Promise<void>((r) => setTimeout(r, 0));
  }

  it("3.1: called with { fieldKey, newValue, previousValue, allValues }", async () => {
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

  it("3.2: the patch from the leaf onChange is applied to the parent group", async () => {
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

  it("3.3: an error in the leaf onChange does not block the value write", async () => {
    const config = {
      toggle: { value: false, onChange: () => { throw new Error("boom"); } },
    };
    const store = new Palistor({ config });
    store.proxy.toggle.value = true;
    await flushPromises();
    expect(store.proxy.toggle.value).toBe(true);
  });

  it("3.4: the leaf onChange and the parent group onChange both fire", async () => {
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

  it("3.5: an async patch from the leaf onChange applies after the promise resolves", async () => {
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

  it("3.6: the leaf onChange is not invoked when the value is unchanged", async () => {
    const spy = vi.fn();
    const config = { name: { value: "same", onChange: spy } };
    const store = new Palistor({ config });
    store.proxy.name.value = "same";
    await flushPromises();
    expect(spy).not.toHaveBeenCalled();
  });
});

