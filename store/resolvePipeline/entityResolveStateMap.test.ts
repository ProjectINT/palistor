import { describe, it, expect } from "vitest";
import { EntityResolveStateMap } from "./types";

// ─── EntityResolveStateMap unit tests ─────────────────────────────────────────

describe("EntityResolveStateMap", () => {
  // ─── get / getOrCreate ──────────────────────────────────────────────────────

  describe("get", () => {
    it("returns undefined for unknown entityId", () => {
      const map = new EntityResolveStateMap();
      const node = {};
      expect(map.get("e1", node)).toBeUndefined();
    });

    it("returns undefined for unknown node within known entityId", () => {
      const map = new EntityResolveStateMap();
      const node = {};
      const otherNode = {};
      map.getOrCreate("e1", node);
      expect(map.get("e1", otherNode)).toBeUndefined();
    });
  });

  describe("getOrCreate", () => {
    it("creates a new idle state if not present", () => {
      const map = new EntityResolveStateMap();
      const node = {};
      const state = map.getOrCreate("e1", node);

      expect(state.status).toBe("idle");
      expect(state.promise).toBeNull();
      expect(state.error).toBeNull();
      expect(state.attempt).toBe(0);
      expect(state.dependencies.size).toBe(0);
    });

    it("uses provided deps when creating", () => {
      const map = new EntityResolveStateMap();
      const node = {};
      const deps = new Set(["field.a", "field.b"]);
      const state = map.getOrCreate("e1", node, deps);

      expect(state.dependencies).toBe(deps);
      expect(state.dependencies.size).toBe(2);
    });

    it("returns existing state on subsequent calls (does not overwrite)", () => {
      const map = new EntityResolveStateMap();
      const node = {};
      const state1 = map.getOrCreate("e1", node);
      state1.status = "pending";

      const state2 = map.getOrCreate("e1", node, new Set(["new.dep"]));
      expect(state2).toBe(state1);
      expect(state2.status).toBe("pending"); // unchanged
    });

    it("get returns the created state", () => {
      const map = new EntityResolveStateMap();
      const node = {};
      const created = map.getOrCreate("e1", node);
      expect(map.get("e1", node)).toBe(created);
    });
  });

  // ─── Isolation between entities / nodes ─────────────────────────────────────

  describe("isolation", () => {
    it("different entityIds with same node are independent", () => {
      const map = new EntityResolveStateMap();
      const node = {};
      const s1 = map.getOrCreate("e1", node);
      const s2 = map.getOrCreate("e2", node);

      s1.status = "resolved";
      expect(s2.status).toBe("idle");
    });

    it("different nodes with same entityId are independent", () => {
      const map = new EntityResolveStateMap();
      const nodeA = {};
      const nodeB = {};
      const sA = map.getOrCreate("e1", nodeA);
      const sB = map.getOrCreate("e1", nodeB);

      sA.status = "error";
      expect(sB.status).toBe("idle");
    });
  });

  // ─── delete ─────────────────────────────────────────────────────────────────

  describe("delete", () => {
    it("delete without node removes all entries for the entity", () => {
      const map = new EntityResolveStateMap();
      const nodeA = {};
      const nodeB = {};
      map.getOrCreate("e1", nodeA);
      map.getOrCreate("e1", nodeB);

      map.delete("e1");

      expect(map.get("e1", nodeA)).toBeUndefined();
      expect(map.get("e1", nodeB)).toBeUndefined();
    });

    it("delete with node removes only that entry", () => {
      const map = new EntityResolveStateMap();
      const nodeA = {};
      const nodeB = {};
      map.getOrCreate("e1", nodeA);
      const stateB = map.getOrCreate("e1", nodeB);

      map.delete("e1", nodeA);

      expect(map.get("e1", nodeA)).toBeUndefined();
      expect(map.get("e1", nodeB)).toBe(stateB);
    });

    it("delete does not affect other entities", () => {
      const map = new EntityResolveStateMap();
      const node = {};
      map.getOrCreate("e1", node);
      const s2 = map.getOrCreate("e2", node);

      map.delete("e1");

      expect(map.get("e2", node)).toBe(s2);
    });

    it("delete of unknown entity is a no-op", () => {
      const map = new EntityResolveStateMap();
      expect(() => map.delete("nonexistent")).not.toThrow();
    });
  });

  // ─── entries ────────────────────────────────────────────────────────────────

  describe("entries", () => {
    it("yields nothing when map is empty", () => {
      const map = new EntityResolveStateMap();
      const result = [...map.entries()];
      expect(result).toHaveLength(0);
    });

    it("yields all (entityId, node, state) triples", () => {
      const map = new EntityResolveStateMap();
      const nodeA = {};
      const nodeB = {};
      const s1 = map.getOrCreate("e1", nodeA);
      const s2 = map.getOrCreate("e1", nodeB);
      const s3 = map.getOrCreate("e2", nodeA);

      const result = [...map.entries()];
      expect(result).toHaveLength(3);

      expect(result).toContainEqual({ entityId: "e1", node: nodeA, state: s1 });
      expect(result).toContainEqual({ entityId: "e1", node: nodeB, state: s2 });
      expect(result).toContainEqual({ entityId: "e2", node: nodeA, state: s3 });
    });

    it("does not yield entries after delete", () => {
      const map = new EntityResolveStateMap();
      const node = {};
      map.getOrCreate("e1", node);
      map.delete("e1");

      expect([...map.entries()]).toHaveLength(0);
    });
  });
});
