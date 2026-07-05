/**
 * Regression: a GROUP's isVisible depending on a leaf of ANOTHER sibling
 * group must recompute during a targeted recompute.
 *
 * The bug: a group node's compute entry (with isVisible) lives in
 * groupComputeMap under the PARENT, but the cross-group dependency was
 * recorded on the group's own path. When a sibling group's leaf changed, the
 * recompute only touched the group's children — not its own isVisible entry
 * (which lives under the parent) — so isVisible stayed stale. The fix: the
 * dependency recipient = the parent group's path (the compute entry's owner).
 * See GroupDepsMap.getTrackingWrap.
 */
import { describe, it, expect } from "vitest";
import { Palistor } from "../../store";

describe("cross-group group isVisible — targeted recompute", () => {
  it("a group's isVisible reacts to a sibling group's leaf", () => {
    const store = new Palistor({
      config: {
        a: { kind: { value: "" } },
        b: {
          x: { value: "" },
          isVisible: (values: any) => values.a.kind === "yes",
        },
      } as any,
    });

    const bNode = (store as any).rootConfig.b;
    // Initially a.kind !== "yes" → b is hidden.
    expect(store.nodes.nodeState.get(bNode)?.isVisible).toBe(false);
    expect((store.proxy as any).b.isVisible).toBe(false);

    // Write to the other group's leaf — b.isVisible must become true.
    (store.proxy as any).a.kind.value = "yes";
    expect((store.proxy as any).b.isVisible).toBe(true);

    // And back — reactivity works both ways.
    (store.proxy as any).a.kind.value = "no";
    expect((store.proxy as any).b.isVisible).toBe(false);
  });

  it("a group's isVisible reacts to a leaf in a NESTED sibling group", () => {
    const store = new Palistor({
      config: {
        source: {
          inner: { flag: { value: "off" } },
        },
        target: {
          y: { value: "" },
          isVisible: (values: any) => values.source.inner.flag === "on",
        },
      } as any,
    });

    const targetNode = (store as any).rootConfig.target;
    expect(store.nodes.nodeState.get(targetNode)?.isVisible).toBe(false);

    (store.proxy as any).source.inner.flag.value = "on";
    expect((store.proxy as any).target.isVisible).toBe(true);
  });
});
