/**
 * Regression: a computed leaf written against its documented group scope
 * (e.g. `full: (v) => v.first.trim() + " " + v.last.trim()`) must not crash
 * the constructor when `initialValues` doesn't provide those fields.
 *
 * At registration the computed function used to be invoked unguarded with the
 * raw initialValues slice (usually `{}`) — a different argument shape than the
 * group-scoped values it receives at recompute time — so any method call on a
 * sibling value threw a TypeError during construction. Flags on the same node
 * were already guarded via safeResolveFlag; the value call was not.
 * The registration-time value is transient anyway: the constructor's first
 * full recompute re-evaluates it against the complete valuesCache.
 */
import { describe, it, expect } from "vitest";
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
});
