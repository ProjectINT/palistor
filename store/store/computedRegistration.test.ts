/**
 * Regression: a computed leaf written against its documented group scope
 * (e.g. `full: (v) => v.first.trim() + " " + v.last.trim()`) must not crash
 * the constructor when `initialValues` doesn't provide those fields.
 *
 * At registration a computed value used to be invoked with the raw initialValues
 * slice (usually `{}`) — a different argument shape than the group-scoped values
 * it receives at recompute time — so any method call on a sibling value threw a
 * TypeError during construction. Registration no longer evaluates computed
 * values at all: the value is transient anyway, since the constructor's first
 * full recompute evaluates every computed leaf against the complete valuesCache
 * (in topological order) before the dirty baseline is captured.
 */
import { describe, it, expect } from "vitest";
import { Palistor } from "../store";

type Names = { first: string; last: string };

describe("computed leaf at registration", () => {
  it("does not crash without initialValues (documented same-group pattern)", () => {
    const store = new Palistor({
      config: {
        form: {
          first: { value: "Ann" },
          last: { value: "Lee" },
          full: { value: (v: Names) => v.first.trim() + " " + v.last.trim() },
        },
      },
    });
    // and the first recompute produced the correct value
    expect(store.proxy.form.full.value).toBe("Ann Lee");
  });

  it("does not crash with PARTIAL initialValues", () => {
    const store = new Palistor({
      config: {
        form: {
          first: { value: "Ann" },
          last: { value: "Lee" },
          full: { value: (v: Names) => v.first.trim() + " " + v.last.trim() },
        },
      },
      initialValues: { form: { first: "Bob" } },
    });
    expect(store.proxy.form.full.value).toBe("Bob Lee");
  });

  it("control: full initialValues keep working", () => {
    const store = new Palistor({
      config: {
        form: {
          first: { value: "Ann" },
          last: { value: "Lee" },
          full: { value: (v: Names) => v.first.trim() + " " + v.last.trim() },
        },
      },
      initialValues: { form: { first: "Bob", last: "Roe" } },
    });
    expect(store.proxy.form.full.value).toBe("Bob Roe");
  });

  it("an arithmetic computed never sees the partial slice (no transient NaN)", () => {
    // The silent cousin of the crash: evaluated against `{}` this returns NaN
    // instead of throwing, so it used to poison the values cache until the first
    // recompute. Registration must not evaluate it at all.
    const store = new Palistor({
      config: {
        cart: {
          price: { value: 10 },
          quantity: { value: 3 },
          total: { value: (v: { price: number; quantity: number }) => v.price * v.quantity },
        },
      },
    });
    expect(store.proxy.cart.total.value).toBe(30);
    expect(store.getValues()).toEqual({ cart: { price: 10, quantity: 3, total: 30 } });
  });

  it("a genuinely broken computed still surfaces — it is not swallowed", () => {
    // Skipping evaluation at registration must not mask real bugs: the first
    // full recompute runs the same function unguarded.
    expect(
      () =>
        new Palistor({
          config: {
            form: {
              first: { value: "Ann" },
              broken: { value: (v: { nope: string }) => v.nope.trim() },
            },
          },
        }),
    ).toThrow(TypeError);
  });
});

describe("computed value inside a list template", () => {
  const listConfig = {
    users: [
      {
        id: { value: "" },
        first: { value: "" },
        last: { value: "" },
        full: { value: (v: Names) => v.first.trim() + " " + v.last.trim() },
      },
    ],
  };

  it("is rejected at construction with the offending path", () => {
    // TEMPORARY: per-item computed values are not implemented (the rule would
    // never run — see assertNoComputedValues). Until they are, this must fail
    // loudly instead of leaking the raw function onto `item.full.value`; before
    // this fix it crashed with a bare TypeError from deep inside recomputeLeaves.
    expect(() => new Palistor({ config: listConfig })).toThrow(/users\[\]\.full/);
    expect(() => new Palistor({ config: listConfig })).toThrow(
      /not supported inside a list template yet/,
    );
  });

  it("a nested template group is checked too", () => {
    expect(
      () =>
        new Palistor({
          config: {
            users: [
              {
                id: { value: "" },
                name: {
                  first: { value: "" },
                  last: { value: "" },
                  full: { value: (v: Names) => v.first.trim() + " " + v.last.trim() },
                },
              },
            ],
          },
        }),
    ).toThrow(/users\[\]\.name\.full/);
  });

  it("a template with plain values and computed rules still constructs", () => {
    const store = new Palistor({
      config: {
        users: [
          {
            id: { value: "" },
            first: { value: "" },
            // Computed RULES (not `value`) are fine — they run per item.
            nickname: { value: "", isVisible: (v: { first: string }) => v.first.length > 0 },
          },
        ],
      },
    });
    store.set({ id: "u1", first: "Ann" });
    (store.proxy.users as unknown as { add: (id: string) => void }).add("u1");
    expect(store.getValues()).toEqual({ users: [{ id: "u1", first: "Ann" }] });
  });
});
