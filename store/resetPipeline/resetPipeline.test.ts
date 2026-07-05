import { describe, it, expect, vi } from "vitest";
import { collectDefaults } from "./collectDefaults";
import { buildResetPatch } from "./buildResetPatch";
import { Palistor } from "../store";
import type { AnyConfigNode } from "../store/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const leaf = (value: unknown): AnyConfigNode => ({ value });
const computed = (): AnyConfigNode => ({ value: () => "computed" });

// ─── collectDefaults ─────────────────────────────────────────────────────────

describe("collectDefaults", () => {
  it("takes the static value from a leaf node", () => {
    const node: AnyConfigNode = { name: leaf("Alice") };
    expect(collectDefaults(node)).toEqual({ name: "Alice" });
  });

  it("a computed field (function) returns an empty string", () => {
    const node: AnyConfigNode = { title: computed() };
    expect(collectDefaults(node)).toEqual({ title: "" });
  });

  it("recursively walks groups without reset", () => {
    const node: AnyConfigNode = {
      address: { city: leaf("Moscow"), zip: leaf("101000") },
    };
    expect(collectDefaults(node)).toEqual({
      address: { city: "Moscow", zip: "101000" },
    });
  });

  it("stops at a reset boundary (a nested group with its own reset)", () => {
    const node: AnyConfigNode = {
      name: leaf("Bob"),
      shipping: { reset: () => ({}), city: leaf("Paris") },
    };
    const result = collectDefaults(node);
    expect(result.name).toBe("Bob");
    expect("shipping" in result).toBe(false);
  });

  it("skips service config keys (value, validate, …)", () => {
    const node: AnyConfigNode = {
      field: leaf("x"),
      validate: () => undefined,
    };
    expect(Object.keys(collectDefaults(node))).not.toContain("validate");
  });
});

// ─── buildResetPatch ─────────────────────────────────────────────────────────

describe("buildResetPatch", () => {
  it("returns the provided values unchanged", () => {
    const node: AnyConfigNode = { name: leaf("") };
    const values = { name: "explicit" };
    expect(buildResetPatch(node, undefined, values)).toBe(values);
  });

  it("without an initialValueMap uses collectDefaults", () => {
    const node: AnyConfigNode = { age: leaf(42) };
    expect(buildResetPatch(node, undefined, undefined)).toEqual({ age: 42 });
  });

  it("with an initialValueMap uses the initial snapshot", () => {
    const ageNode: AnyConfigNode = { value: 0 };
    const node: AnyConfigNode = { age: ageNode };
    const initialValueMap = new WeakMap<object, unknown>([[ageNode, 25]]);
    expect(buildResetPatch(node, initialValueMap, undefined)).toEqual({ age: 25 });
  });

  it("applies the group's reset transformer", () => {
    const node: AnyConfigNode = {
      count: leaf(0),
      reset: (v: Record<string, unknown>) => ({ ...v, count: -1 }),
    };
    const result = buildResetPatch(node, undefined, undefined);
    expect(result.count).toBe(-1);
  });

  it("the reset transformer is not invoked with explicit values", () => {
    const resetFn = vi.fn((v: Record<string, unknown>) => v);
    const node: AnyConfigNode = { x: leaf(0), reset: resetFn };
    buildResetPatch(node, undefined, { x: 99 });
    expect(resetFn).not.toHaveBeenCalled();
  });
});

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
