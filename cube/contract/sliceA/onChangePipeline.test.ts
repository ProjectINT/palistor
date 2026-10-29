import { describe, it, expect, vi } from "vitest";
import { Palistor } from "@impl";

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

