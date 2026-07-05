import { describe, it, expect, beforeEach } from "vitest";
import { EntityRegistry } from "./entityRegistry";
import type { EntityNode } from "./types";
import { isGroupNode } from "../traversal/nodeClassifier";

// ─── Test data ───────────────────────────────────────────────────────────────

const template1 = { name: "template1" }; // simple stub for a template node
const template2 = { name: "template2" };

// ─── EntityRegistry tests ────────────────────────────────────────────────────

describe("EntityRegistry", () => {

  // ── CRUD and EntityNode ───────────────────────────────────────────────────

  describe("upsert — creation", () => {
    it("creates a new entity with leaf nodes", () => {
      const registry = new EntityRegistry();
      const node = registry.upsert({ id: "u1", name: "Alice", age: 30 });

      expect(node).toBeDefined();
      expect(node.id.value).toBe("u1");
      expect((node.name as any).value).toBe("Alice");
      expect((node.age as any).value).toBe(30);
    });

    it("returns the same node stored in the registry", () => {
      const registry = new EntityRegistry();
      const returned = registry.upsert({ id: "u1", name: "Alice" });
      const stored = registry.get("u1");
      expect(returned).toBe(stored);
    });

    it("supports nested objects (groups)", () => {
      const registry = new EntityRegistry();
      const node = registry.upsert({ id: "u1", passport: { number: "123", issueDate: "2020-01-01" } });

      const passport = node.passport as EntityNode;
      expect(passport).toBeDefined();
      expect(isGroupNode(passport as object)).toBe(true); // it's a group, not a leaf
      expect((passport.number as any).value).toBe("123");
      expect((passport.issueDate as any).value).toBe("2020-01-01");
    });

    it("creates a leaf for null values", () => {
      const registry = new EntityRegistry();
      const node = registry.upsert({ id: "u1", name: null });
      expect((node.name as any).value).toBeNull();
    });

    it("creates a leaf for numeric values", () => {
      const registry = new EntityRegistry();
      const node = registry.upsert({ id: "u1", count: 0 });
      expect((node.count as any).value).toBe(0);
    });

    it("creates a leaf for boolean values", () => {
      const registry = new EntityRegistry();
      const node = registry.upsert({ id: "u1", active: false });
      expect((node.active as any).value).toBe(false);
    });

    it("does NOT duplicate a leaf for the id field (special case)", () => {
      const registry = new EntityRegistry();
      const node = registry.upsert({ id: "u1", name: "Alice" });
      // id is a dedicated leaf, never duplicated
      expect(Object.keys(node)).toContain("id");
      expect((node.id as any).value).toBe("u1");
    });
  });

  describe("upsert — merge (update)", () => {
    it("updates existing fields without deleting absent ones", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1", name: "Alice", age: 30 });
      const node = registry.upsert({ id: "u1", name: "Alice Updated" });

      expect((node.name as any).value).toBe("Alice Updated");
      // age was not in the update — it stays
      expect((node.age as any).value).toBe(30);
    });

    it("returns the same node object on merge (shared reference)", () => {
      const registry = new EntityRegistry();
      const first = registry.upsert({ id: "u1", name: "Alice" });
      const second = registry.upsert({ id: "u1", name: "Bob" });
      expect(first).toBe(second);
    });

    it("updates the leaf in place (mutation, not replacement)", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1", name: "Alice" });
      const node = registry.get("u1")!;
      const nameLeaf = node.name as any;

      registry.upsert({ id: "u1", name: "Bob" });

      // nameLeaf is the same object; only value changed
      expect(nameLeaf.value).toBe("Bob");
      expect(node.name).toBe(nameLeaf); // reference preserved
    });

    it("adds new fields on merge", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1", name: "Alice" });
      registry.upsert({ id: "u1", email: "alice@example.com" });
      const node = registry.get("u1")!;

      expect((node.name as any).value).toBe("Alice");
      expect((node.email as any).value).toBe("alice@example.com");
    });

    it("recursive merge of nested groups", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1", passport: { number: "123", issueDate: "2020-01-01" } });
      registry.upsert({ id: "u1", passport: { number: "456" } }); // update number only

      const node = registry.get("u1")!;
      const passport = node.passport as EntityNode;

      expect((passport.number as any).value).toBe("456");
      expect((passport.issueDate as any).value).toBe("2020-01-01"); // not deleted
    });

    it("recursive merge updates a nested leaf in place", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1", passport: { number: "123" } });
      const passportNode = (registry.get("u1")! as any).passport;
      const numberLeaf = passportNode.number;

      registry.upsert({ id: "u1", passport: { number: "999" } });

      // Same leaf object, mutated in place
      expect(numberLeaf.value).toBe("999");
      expect(passportNode.number).toBe(numberLeaf);
    });
  });

  describe("get / has / size / delete", () => {
    it("get returns undefined for a missing entity", () => {
      const registry = new EntityRegistry();
      expect(registry.get("nonexistent")).toBeUndefined();
    });

    it("has returns true for an existing entity", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1" });
      expect(registry.has("u1")).toBe(true);
    });

    it("has returns false for a missing entity", () => {
      const registry = new EntityRegistry();
      expect(registry.has("u1")).toBe(false);
    });

    it("size reflects the number of entities", () => {
      const registry = new EntityRegistry();
      expect(registry.size).toBe(0);
      registry.upsert({ id: "u1" });
      expect(registry.size).toBe(1);
      registry.upsert({ id: "u2" });
      expect(registry.size).toBe(2);
    });

    it("delete removes the entity", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1" });
      const result = registry.delete("u1");

      expect(result).toBe(true);
      expect(registry.has("u1")).toBe(false);
      expect(registry.size).toBe(0);
    });

    it("delete returns false for a missing entity", () => {
      const registry = new EntityRegistry();
      expect(registry.delete("u1")).toBe(false);
    });

    it("delete clears the bindings", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1" });
      registry.bind("u1", template1);
      registry.delete("u1");

      // After re-creating the entity — no bindings remain
      registry.upsert({ id: "u1" });
      expect(registry.getBindings("u1")).toBeUndefined();
    });

    it("delete clears the resolvedCache", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1" });
      registry.markResolved("u1", template1);
      registry.delete("u1");

      // After re-creation — resolve is no longer marked as done
      registry.upsert({ id: "u1" });
      expect(registry.isResolved("u1", template1)).toBe(false);
    });
  });

  // ── ID auto-generation ────────────────────────────────────────────────────

  describe("ID auto-generation", () => {
    it("generates a _tmp_ id when the id is missing", () => {
      const registry = new EntityRegistry();
      const node = registry.upsert({ name: "NoId" });
      expect((node.id as any).value).toMatch(/^_tmp_/);
    });

    it("generates a _tmp_ id when the id is an empty string", () => {
      const registry = new EntityRegistry();
      const node = registry.upsert({ id: "", name: "EmptyId" });
      expect((node.id as any).value).toMatch(/^_tmp_/);
    });

    it("generates a _tmp_ id when the id is whitespace", () => {
      const registry = new EntityRegistry();
      const node = registry.upsert({ id: "   ", name: "SpaceId" });
      expect((node.id as any).value).toMatch(/^_tmp_/);
    });

    it("generates unique _tmp_ ids across multiple calls", () => {
      const registry = new EntityRegistry();
      const node1 = registry.upsert({ name: "First" });
      const node2 = registry.upsert({ name: "Second" });
      expect((node1.id as any).value).not.toBe((node2.id as any).value);
    });

    it("uses the explicit id when provided", () => {
      const registry = new EntityRegistry();
      const node = registry.upsert({ id: "u1", name: "Alice" });
      expect((node.id as any).value).toBe("u1");
    });
  });

  // ── Bind / Unbind ─────────────────────────────────────────────────────────

  describe("bind / unbind / getBindings", () => {
    it("bind adds the template to the binding Set", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1" });
      registry.bind("u1", template1);

      const bindings = registry.getBindings("u1");
      expect(bindings).toBeDefined();
      expect(bindings!.has(template1)).toBe(true);
    });

    it("bind supports multiple templates for one entity", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1" });
      registry.bind("u1", template1);
      registry.bind("u1", template2);

      const bindings = registry.getBindings("u1");
      expect(bindings!.size).toBe(2);
      expect(bindings!.has(template1)).toBe(true);
      expect(bindings!.has(template2)).toBe(true);
    });

    it("unbind removes the template from the bindings", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1" });
      registry.bind("u1", template1);
      registry.bind("u1", template2);
      registry.unbind("u1", template1);

      const bindings = registry.getBindings("u1");
      expect(bindings!.has(template1)).toBe(false);
      expect(bindings!.has(template2)).toBe(true);
    });

    it("unbind — no-op when the template wasn't bound", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1" });
      expect(() => registry.unbind("u1", template1)).not.toThrow();
    });

    it("unbind — no-op when the entity doesn't exist", () => {
      const registry = new EntityRegistry();
      expect(() => registry.unbind("nonexistent", template1)).not.toThrow();
    });

    it("getBindings returns undefined when there are no bindings", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1" });
      expect(registry.getBindings("u1")).toBeUndefined();
    });

    it("getBindings returns undefined when the entity doesn't exist", () => {
      const registry = new EntityRegistry();
      expect(registry.getBindings("nonexistent")).toBeUndefined();
    });
  });

  // ── Resolved cache ────────────────────────────────────────────────────────

  describe("markResolved / isResolved / clearResolved", () => {
    it("isResolved returns false before markResolved", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1" });
      expect(registry.isResolved("u1", template1)).toBe(false);
    });

    it("isResolved returns true after markResolved", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1" });
      registry.markResolved("u1", template1);
      expect(registry.isResolved("u1", template1)).toBe(true);
    });

    it("markResolved does not affect other templates", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1" });
      registry.markResolved("u1", template1);
      expect(registry.isResolved("u1", template2)).toBe(false);
    });

    it("markResolved does not affect other entities", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1" });
      registry.upsert({ id: "u2" });
      registry.markResolved("u1", template1);
      expect(registry.isResolved("u2", template1)).toBe(false);
    });

    it("clearResolved(id) clears the whole cache for the entity", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1" });
      registry.markResolved("u1", template1);
      registry.markResolved("u1", template2);

      registry.clearResolved("u1");

      expect(registry.isResolved("u1", template1)).toBe(false);
      expect(registry.isResolved("u1", template2)).toBe(false);
    });

    it("clearResolved(id, template) clears only the specific template", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "u1" });
      registry.markResolved("u1", template1);
      registry.markResolved("u1", template2);

      registry.clearResolved("u1", template1);

      expect(registry.isResolved("u1", template1)).toBe(false);
      expect(registry.isResolved("u1", template2)).toBe(true); // untouched
    });

    it("clearResolved — no-op for a missing id", () => {
      const registry = new EntityRegistry();
      expect(() => registry.clearResolved("nonexistent")).not.toThrow();
    });

    it("isResolved — false for a missing id", () => {
      const registry = new EntityRegistry();
      expect(registry.isResolved("nonexistent", template1)).toBe(false);
    });
  });

  // ── rekey ─────────────────────────────────────────────────────────────────

  describe("rekey", () => {
    it("moves the entity from oldId to newId", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "tmp1", name: "Alice" });

      registry.rekey("tmp1", "u1");

      expect(registry.has("tmp1")).toBe(false);
      expect(registry.has("u1")).toBe(true);
    });

    it("updates the id leaf value", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "tmp1", name: "Alice" });

      registry.rekey("tmp1", "u1");

      const node = registry.get("u1")!;
      expect((node.id as any).value).toBe("u1");
    });

    it("preserves entity data across rekey", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "tmp1", name: "Alice", age: 30 });

      registry.rekey("tmp1", "u1");

      const node = registry.get("u1")!;
      expect((node.name as any).value).toBe("Alice");
      expect((node.age as any).value).toBe(30);
    });

    it("keeps the same node object (identity preserved)", () => {
      const registry = new EntityRegistry();
      const original = registry.upsert({ id: "tmp1", name: "Alice" });

      registry.rekey("tmp1", "u1");

      expect(registry.get("u1")).toBe(original);
    });

    it("moves the bindings to newId", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "tmp1" });
      registry.bind("tmp1", template1);

      registry.rekey("tmp1", "u1");

      expect(registry.getBindings("tmp1")).toBeUndefined();
      const bindings = registry.getBindings("u1");
      expect(bindings).toBeDefined();
      expect(bindings!.has(template1)).toBe(true);
    });

    it("moves the resolvedCache to newId", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "tmp1" });
      registry.markResolved("tmp1", template1);

      registry.rekey("tmp1", "u1");

      expect(registry.isResolved("tmp1", template1)).toBe(false);
      expect(registry.isResolved("u1", template1)).toBe(true);
    });

    it("rekey — no-op for a missing oldId", () => {
      const registry = new EntityRegistry();
      expect(() => registry.rekey("nonexistent", "u1")).not.toThrow();
      expect(registry.has("u1")).toBe(false);
    });

    it("rekey of an entity with no bindings or resolvedCache", () => {
      const registry = new EntityRegistry();
      registry.upsert({ id: "tmp1", name: "Bob" });

      expect(() => registry.rekey("tmp1", "u2")).not.toThrow();
      expect(registry.has("u2")).toBe(true);
    });
  });

  // ── End-to-end scenario ───────────────────────────────────────────────────

  describe("end-to-end scenario: entity lifecycle", () => {
    it("full cycle: create → bind → markResolved → unbind → delete", () => {
      const registry = new EntityRegistry();

      // Create the entity
      registry.upsert({ id: "u1", name: "Alice", age: 30 });
      expect(registry.has("u1")).toBe(true);

      // Bind it to a form
      registry.bind("u1", template1);
      expect(registry.getBindings("u1")!.has(template1)).toBe(true);

      // Resolve completed
      registry.markResolved("u1", template1);
      expect(registry.isResolved("u1", template1)).toBe(true);

      // Form closed: unbind
      registry.unbind("u1", template1);
      expect(registry.getBindings("u1")!.has(template1)).toBe(false);

      // Reopened — the resolve cache is preserved
      expect(registry.isResolved("u1", template1)).toBe(true);

      // Entity deleted
      registry.delete("u1");
      expect(registry.has("u1")).toBe(false);
    });

    it("tmp → real id: upsert with tmp, rekey to the real one after the API response", () => {
      const registry = new EntityRegistry();

      // Created without an id → _tmp_
      const tmpNode = registry.upsert({ name: "New User" });
      const tmpId = (tmpNode.id as any).value as string;
      expect(tmpId).toMatch(/^_tmp_/);

      registry.bind(tmpId, template1);
      registry.markResolved(tmpId, template1);

      // The server returned the real id
      registry.rekey(tmpId, "u99");

      expect(registry.has(tmpId)).toBe(false);
      expect(registry.has("u99")).toBe(true);
      expect((registry.get("u99")!.id as any).value).toBe("u99");
      expect(registry.isResolved("u99", template1)).toBe(true);
    });

    it("multiple entities are independent", () => {
      const registry = new EntityRegistry();

      registry.upsert({ id: "u1", name: "Alice" });
      registry.upsert({ id: "u2", name: "Bob" });
      registry.upsert({ id: "u3", name: "Charlie" });

      // Alice merge
      registry.upsert({ id: "u1", age: 25 });
      expect((registry.get("u1")!.name as any).value).toBe("Alice");

      // Bob delete
      registry.delete("u2");
      expect(registry.has("u2")).toBe(false);
      expect(registry.size).toBe(2);

      // Charlie rekey
      registry.rekey("u3", "charlie-id");
      expect(registry.has("u3")).toBe(false);
      expect(registry.has("charlie-id")).toBe(true);
    });
  });
});
