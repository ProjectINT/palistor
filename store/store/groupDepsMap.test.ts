import { describe, it, expect } from "vitest";
import { GroupDepsMap } from "./groupDepsMap";
import { buildNodeMaps } from "./nodeMap";
import { pairKey } from "../groupDeps/pairKey";
import type { AnyConfigNode } from "./types";

// ─── Test configs ─────────────────────────────────────────────────────────────

function buildMaps(root: AnyConfigNode) {
  const nodePaths = new WeakMap<object, string>();
  const nodeParents = new WeakMap<object, object>();
  buildNodeMaps(root, nodePaths, nodeParents);
  return { nodePaths, nodeParents };
}

const flat = {
  email: { value: "" },
  name: { value: "" },
} as unknown as AnyConfigNode;

const nested = {
  paymentType: { value: "card" },
  passport: {
    number: { value: "" },
  },
} as unknown as AnyConfigNode;

// Two sibling groups: `b` (a group node) reads a leaf of the other group `a`.
// This is a real cross-group dependency for a group-node isVisible.
const siblingGroups = {
  a: { kind: { value: "" } },
  b: { x: { value: "" } },
} as unknown as AnyConfigNode;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GroupDepsMap", () => {
  describe("constructor — dependency initialization", () => {
    it("creates the root self-dependency for a flat config", () => {
      const { nodePaths, nodeParents } = buildMaps(flat);
      const gdm = new GroupDepsMap(flat, nodePaths, nodeParents);
      expect(gdm.deps.has(pairKey("", ""))).toBe(true);
      expect(gdm.deps.size).toBe(1);
    });

    it("creates self-dependencies for the root and nested groups", () => {
      const { nodePaths, nodeParents } = buildMaps(nested);
      const gdm = new GroupDepsMap(nested, nodePaths, nodeParents);
      expect(gdm.deps.has(pairKey("", ""))).toBe(true);
      expect(gdm.deps.has(pairKey("passport", "passport"))).toBe(true);
      expect(gdm.deps.size).toBe(2);
    });
  });

  describe("isBuilt / markBuilt", () => {
    it("isBuilt === false right after construction", () => {
      const { nodePaths, nodeParents } = buildMaps(flat);
      const gdm = new GroupDepsMap(flat, nodePaths, nodeParents);
      expect(gdm.isBuilt).toBe(false);
    });

    it("isBuilt === true after markBuilt()", () => {
      const { nodePaths, nodeParents } = buildMaps(flat);
      const gdm = new GroupDepsMap(flat, nodePaths, nodeParents);
      gdm.markBuilt();
      expect(gdm.isBuilt).toBe(true);
    });
  });

  describe("getTrackingWrap — capturing cross-group dependencies", () => {
    it("records a dependency when reading a leaf of ANOTHER sibling group", () => {
      const { nodePaths, nodeParents } = buildMaps(siblingGroups);
      const gdm = new GroupDepsMap(siblingGroups, nodePaths, nodeParents);
      const wrap = gdm.getTrackingWrap();

      // The group node `b` (isVisible) receives its parent's (root) scope. Its
      // compute entry lives under the PARENT (root), so the dependency recipient
      // is "" (root), not its own path "b". Reading values.a.kind → donor "a" ≠
      // recipient "" → the pair "a" → "" is recorded.
      const b = (siblingGroups as any).b;
      const rootValues = { a: { kind: "" }, b: { x: "" } };
      const tracked = wrap(b, rootValues as any);

      void (tracked as any).a.kind;
      expect(gdm.deps.has(pairKey("a", ""))).toBe(true);
      // The dependency is NOT recorded on the group's own path — otherwise a
      // recompute of "b" only touches b's children, not its own isVisible entry
      // (which lives under root).
      expect(gdm.deps.has(pairKey("a", "b"))).toBe(false);
    });

    it("reading a leaf of the same (parent) group creates no cross-group pair", () => {
      const { nodePaths, nodeParents } = buildMaps(nested);
      const gdm = new GroupDepsMap(nested, nodePaths, nodeParents);
      const wrap = gdm.getTrackingWrap();

      // passport (a group node) reads the root-level sibling paymentType. Both
      // entries are under root, so this is the root's self-dependency ("" → ""),
      // already covered by the constructor; no separate cross-group pair is needed.
      const passport = (nested as any).passport;
      const rootValues = { paymentType: "card", passport: { number: "" } };
      const tracked = wrap(passport, rootValues as any);

      void (tracked as any).paymentType;
      expect(gdm.deps.has(pairKey("", "passport"))).toBe(false);
    });

    it("memoizes the proxy by recipientPath: a repeat call for the same node returns the same object", () => {
      const { nodePaths, nodeParents } = buildMaps(nested);
      const gdm = new GroupDepsMap(nested, nodePaths, nodeParents);
      const wrap = gdm.getTrackingWrap();

      const passportNumber = (nested as any).passport.number;
      const values = { paymentType: "card", passport: { number: "" } };
      const proxy1 = wrap(passportNumber, values as any);
      const proxy2 = wrap(passportNumber, values as any);
      expect(proxy1).toBe(proxy2);
    });

    it("markBuilt releases the proxy cache (a repeat call creates a new object)", () => {
      const { nodePaths, nodeParents } = buildMaps(nested);
      const gdm = new GroupDepsMap(nested, nodePaths, nodeParents);
      const wrap = gdm.getTrackingWrap();

      const passportNumber = (nested as any).passport.number;
      const values = { paymentType: "card", passport: { number: "" } };
      const proxy1 = wrap(passportNumber, values as any);

      gdm.markBuilt();

      // After markBuilt the cache is cleared — a new Proxy
      const proxy2 = wrap(passportNumber, values as any);
      expect(proxy1).not.toBe(proxy2);
    });
  });
});
