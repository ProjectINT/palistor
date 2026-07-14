/**
 * Regression: a computed leaf written against its documented group scope
 * (e.g. `full: (v) => v.first.trim() + " " + v.last.trim()`) must not crash
 * the constructor when `initialValues` doesn't provide those fields.
 *
 * At registration the computed function used to be invoked with the raw
 * initialValues slice (usually `{}`) — a different argument shape than the
 * group-scoped values it receives at recompute time — so any method call on a
 * sibling value threw a TypeError during construction.
 *
 * The fix is not to catch that throw but to not make the call: a computed leaf
 * is left unevaluated at registration. Its value is transient anyway — the
 * constructor's first full recompute evaluates every computed leaf against the
 * complete valuesCache, in topological order, before the dirty baseline is
 * captured. Catching would also have run user code against a garbage argument
 * and swallowed genuine bugs.
 */
import { describe, it, expect, vi } from "vitest";
import { Palistor } from "../store";

describe("computed leaf at registration", () => {
  it("does not crash without initialValues (documented same-group pattern)", () => {
    const store = new Palistor({
      config: {
        form: {
          first: { value: "Ann" },
          last: { value: "Lee" },
          full: { value: (v: any) => v.first.trim() + " " + v.last.trim() },
        },
      } as any,
    });
    // and the first recompute produced the correct value
    expect((store.proxy as any).form.full.value).toBe("Ann Lee");
  });

  it("does not crash with PARTIAL initialValues", () => {
    const store = new Palistor({
      config: {
        form: {
          first: { value: "Ann" },
          last: { value: "Lee" },
          full: { value: (v: any) => v.first.trim() + " " + v.last.trim() },
        },
      } as any,
      initialValues: { form: { first: "Bob" } } as any,
    });
    expect((store.proxy as any).form.full.value).toBe("Bob Lee");
  });

  it("control: full initialValues keep working", () => {
    const store = new Palistor({
      config: {
        form: {
          first: { value: "Ann" },
          last: { value: "Lee" },
          full: { value: (v: any) => v.first.trim() + " " + v.last.trim() },
        },
      } as any,
      initialValues: { form: { first: "Bob", last: "Roe" } } as any,
    });
    expect((store.proxy as any).form.full.value).toBe("Bob Roe");
  });

  it("never invokes the computed fn against the initialValues slice", () => {
    // Every invocation must see the full group scope. A call with the raw
    // initialValues slice (`{}` / `{ first: "Bob" }`) means the function ran
    // against the wrong argument shape.
    const spy = vi.fn((v: any) => `${v.first} ${v.last}`);
    new Palistor({
      config: {
        form: {
          first: { value: "Ann" },
          last: { value: "Lee" },
          full: { value: spy },
        },
      } as any,
      initialValues: { form: { first: "Bob" } } as any,
    });

    expect(spy).toHaveBeenCalled();
    for (const [values] of spy.mock.calls) {
      expect(values).toMatchObject({ first: "Bob", last: "Lee" });
    }
  });

  it("does NOT swallow a genuine bug in a computed fn", () => {
    // `v.frist` is a typo — there is no such sibling. This must surface, not be
    // silently turned into "". Guarding registration with try/catch risked
    // hiding exactly this class of error.
    expect(
      () =>
        new Palistor({
          config: {
            form: {
              first: { value: "Ann" },
              bad: { value: (v: any) => v.frist.trim() },
            },
          } as any,
        }),
    ).toThrow(/frist|undefined/i);
  });
});

describe("computed leaf inside a list template", () => {
  it("rejects a computed value with an actionable error", () => {
    // The template is a rule set shared by every item: an item's value comes
    // from its entity leaf and `rules.value` is never invoked as a function, so
    // the rule would silently never run. Fail at construction instead.
    expect(
      () =>
        new Palistor({
          config: {
            users: [
              {
                first: { value: "" },
                last: { value: "" },
                full: { value: (v: any) => v.first.trim() + " " + v.last.trim() },
              },
            ],
          } as any,
        }),
    ).toThrow(/computed "value" is not supported inside a list template.*users\[\]\.full/s);
  });

  it("reports the path of a computed value nested in a template group", () => {
    expect(
      () =>
        new Palistor({
          config: {
            users: [
              {
                profile: {
                  city: { value: "" },
                  display: { value: (v: any) => v.city.trim() },
                },
              },
            ],
          } as any,
        }),
    ).toThrow(/users\[\]\.profile\.display/);
  });

  it("a template with plain values still constructs and takes entity values", () => {
    const store = new Palistor({
      config: {
        users: [{ first: { value: "" }, last: { value: "" } }],
      } as any,
    });
    (store.proxy as any).users.add({ id: "u1", first: "Ann", last: "Lee" });
    expect(store.getValues()).toMatchObject({
      users: [{ id: "u1", first: "Ann", last: "Lee" }],
    });
  });
});
