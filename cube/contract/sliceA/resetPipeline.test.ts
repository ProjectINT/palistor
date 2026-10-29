import { describe, it, expect, vi } from "vitest";
import { Palistor } from "@impl";

// ─── executeReset (integration) ──────────────────────────────────────────────

describe("executeReset (through store)", () => {
  const makeConfig = () => ({
    name: { value: "", label: "Name" },
    age: { value: 0, label: "Age" },
    address: {
      city: { value: "", label: "City" },
      zip: { value: "", label: "ZIP" },
    },
  });

  it("resets values to the initial snapshot", () => {
    const store = new Palistor({ config: makeConfig() });
    store.proxy.name.value = "Alice";
    store.proxy.age.value = 30;

    store.reset();

    expect(store.proxy.name.value).toBe("");
    expect(store.proxy.age.value).toBe(0);
  });

  it("fields are not dirty after reset", () => {
    const store = new Palistor({ config: makeConfig() });
    store.proxy.name.value = "Alice";
    expect(store.proxy.name.dirty).toBe(true);

    store.reset();

    expect(store.proxy.name.dirty).toBe(false);
  });

  it("reset with explicit values applies them as the new baseline", () => {
    const store = new Palistor({ config: makeConfig() });
    store.reset({ name: "Bob", age: 20 });

    expect(store.proxy.name.value).toBe("Bob");
    expect(store.proxy.age.value).toBe(20);
    // New values are captured as initial → field should not be dirty
    expect(store.proxy.name.dirty).toBe(false);
  });

  it("resets only the nested group", () => {
    const store = new Palistor({ config: makeConfig() });
    store.proxy.name.value = "Alice";
    store.proxy.address.city.value = "Moscow";

    // Per-group reset is accessed through the group proxy's .reset() method
    store.proxy.address.reset();

    expect(store.proxy.address.city.value).toBe("");
    expect(store.proxy.name.value).toBe("Alice"); // untouched
  });
});
