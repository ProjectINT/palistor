/**
 * Regression: a cross-group dependency that is only read inside a conditional
 * branch which is INACTIVE at init must still become reactive once the branch
 * first runs.
 *
 * The dependency graph is discovered by tracking reads during recompute. Before
 * the fix it was traced only during the first `recomputeAll` and then frozen,
 * so an edge whose read lives behind a branch inactive at init (here: `b`
 * reads `c.addr` only when `a.method === "courier"`) was never recorded — and
 * later changes to `c.addr` never recomputed `b`. Tracking now stays active on
 * targeted recomputes too, so the `c → b` edge is recorded the first time the
 * branch executes, and the dependency set grows monotonically.
 *
 * Group-level granularity does NOT mask this: in a two-group `a → b` setup any
 * read of group `a` records the edge, so any change in `a` recomputes `b`.
 * Here the conditionally-read field lives in a third group `c` that is not a
 * donor at init at all.
 */
import { describe, it, expect } from "vitest";
import { Palistor } from "../../store";

describe("conditional cross-group dependency", () => {
  it("recomputes b.isVisible when c.addr changes after the branch became active", () => {
    const store = new Palistor({
      config: {
        a: { method: { value: "start" } },
        c: { addr: { value: "" } },
        b: {
          x: { value: "" },
          // reads v.c.addr ONLY in the "courier" branch — inactive at init
          isVisible: (v: any) =>
            v.a.method === "courier" ? v.c.addr !== "" : false,
        },
      } as any,
    });

    const p = store.proxy as any;

    // init: hidden
    expect(p.b.isVisible).toBe(false);

    // activate the branch (a -> b was traced at init via v.a.method)
    p.a.method.value = "courier";
    expect(p.b.isVisible).toBe(false); // addr still empty

    // fill the conditionally-read field in group c
    p.c.addr.value = "somewhere";

    // c -> b edge is discovered the first time the branch ran → b recomputes
    expect(p.b.isVisible).toBe(true);

    // and stays reactive both ways
    p.c.addr.value = "";
    expect(p.b.isVisible).toBe(false);
  });

  it("control: an unconditional cross-group read is reactive (was never broken)", () => {
    const store = new Palistor({
      config: {
        a: { method: { value: "start" } },
        c: { addr: { value: "" } },
        b: {
          x: { value: "" },
          isVisible: (v: any) => v.c.addr !== "" && v.a.method === "courier",
        },
      } as any,
    });

    const p = store.proxy as any;
    expect(p.b.isVisible).toBe(false);
    p.a.method.value = "courier";
    p.c.addr.value = "somewhere";
    expect(p.b.isVisible).toBe(true);
  });
});
