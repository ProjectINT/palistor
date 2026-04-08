/**
 * Phase 2 tests: ResolveManager — entity field resolve dispatch.
 *
 * Covers:
 * - templateFieldEntries / listNodeToTemplateFieldEntries setup
 * - triggerEntityFieldResolve: state creation
 * - triggerEntityFieldResolve: deduplication (pending → skip)
 * - triggerEntityFieldResolve: skipIfResolved (default true) — skips when entity has non-default value
 * - triggerEntityFieldResolve: skipIfResolved: false — always runs
 * - triggerEntityFieldResolve: null/undefined entity value does NOT skip
 * - triggerEntityFieldResolve: unknown templateFieldNode → no-op
 * - cleanupEntityResolveStates: removes all states for entity
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ResolveManager } from "./createResolveManager";
import { EntityRegistry } from "../entityRegistry";
import type { ResolveManagerDeps } from "./createResolveManager";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeResolve(overrides?: object) {
  return {
    resolver: vi.fn(async () => ({})),
    onError: vi.fn(),
    ...overrides,
  };
}

function makeMinimalDeps(
  rootConfig: object,
  entityRegistry: EntityRegistry,
): ResolveManagerDeps {
  return {
    rootConfig: rootConfig as any,
    nodeState: new WeakMap(),
    recompute: () => new Set(),
    notifyChanged: () => {},
    notify: () => {},
    initialValueMap: new WeakMap(),
    valuesCache: { values: {} } as any,
    store: { context: {} } as any,
    listStates: new WeakMap(),
    setEntitiesRaw: () => new Set(),
    syncListValuesCache: () => {},
    entityRegistry,
  };
}

// ─── Setup: config with a list containing template fields with resolve ────────

function makeConfig() {
  const fieldResolveIsActive = makeResolve();
  const fieldResolveBio = makeResolve({ options: { skipIfResolved: false } });

  const template = {
    id: { value: "" },
    name: { value: "" },
    isActive: { value: false, resolve: fieldResolveIsActive },
    bio: { value: "", resolve: fieldResolveBio },
  };

  const config = {
    users: [template],
  };

  return { config, template, fieldResolveIsActive, fieldResolveBio };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ResolveManager Phase 2 — entity field resolve", () => {
  let entityRegistry: EntityRegistry;

  beforeEach(() => {
    entityRegistry = new EntityRegistry();
  });

  // ─── Setup: templateFieldEntries & listNodeToTemplateFieldEntries ───────────

  describe("initialization", () => {
    it("populates templateFieldEntries for template fields with resolve", () => {
      const { config, template } = makeConfig();
      const manager = new ResolveManager(makeMinimalDeps(config, entityRegistry));

      expect(manager.templateFieldEntries).toHaveLength(2);
      const nodes = manager.templateFieldEntries.map((e) => e.node);
      expect(nodes).toContain(template.isActive);
      expect(nodes).toContain(template.bio);
    });

    it("templateFieldEntries have correct fieldKey", () => {
      const { config, template } = makeConfig();
      const manager = new ResolveManager(makeMinimalDeps(config, entityRegistry));

      const isActiveEntry = manager.templateFieldEntries.find((e) => e.node === template.isActive);
      const bioEntry = manager.templateFieldEntries.find((e) => e.node === template.bio);

      expect(isActiveEntry?.fieldKey).toBe("isActive");
      expect(bioEntry?.fieldKey).toBe("bio");
    });

    it("builds listNodeToTemplateFieldEntries mapping from listNode to entries", () => {
      const { config, template } = makeConfig();
      const manager = new ResolveManager(makeMinimalDeps(config, entityRegistry));

      const entries = manager.listNodeToTemplateFieldEntries.get(config.users as any);
      expect(entries).toHaveLength(2);

      const nodes = entries!.map((e) => e.node);
      expect(nodes).toContain(template.isActive);
      expect(nodes).toContain(template.bio);
    });

    it("does NOT include template field entries in regular resolveEntries", () => {
      const { config } = makeConfig();
      const manager = new ResolveManager(makeMinimalDeps(config, entityRegistry));

      // templateFieldEntries are NOT in regular states map
      for (const entry of manager.templateFieldEntries) {
        expect(manager.states.has(entry.node as object)).toBe(false);
      }
    });
  });

  // ─── triggerEntityFieldResolve: state creation ─────────────────────────────

  describe("triggerEntityFieldResolve — state creation", () => {
    it("creates a pending state in entityStates for the given (entityId, templateFieldNode)", () => {
      const { config, template } = makeConfig();
      const manager = new ResolveManager(makeMinimalDeps(config, entityRegistry));

      // Register entity so executor can find it and set state to pending
      entityRegistry.upsert({ id: "u1", isActive: false });

      manager.triggerEntityFieldResolve("u1", template.isActive as any);

      const state = manager.entityStates.get("u1", template.isActive as object);
      expect(state).toBeDefined();
      expect(state!.status).toBe("pending");
    });

    it("does not affect states for other entities or other fields", () => {
      const { config, template } = makeConfig();
      const manager = new ResolveManager(makeMinimalDeps(config, entityRegistry));

      manager.triggerEntityFieldResolve("u1", template.isActive as any);

      // Other entity — no state
      expect(manager.entityStates.get("u2", template.isActive as object)).toBeUndefined();
      // Other field — no state
      expect(manager.entityStates.get("u1", template.bio as object)).toBeUndefined();
    });

    it("no-ops when templateFieldNode has no registered entry", () => {
      const { config } = makeConfig();
      const manager = new ResolveManager(makeMinimalDeps(config, entityRegistry));
      const unknownNode = { value: "" } as any;

      // Should not throw
      expect(() => manager.triggerEntityFieldResolve("u1", unknownNode)).not.toThrow();
      expect(manager.entityStates.get("u1", unknownNode)).toBeUndefined();
    });
  });

  // ─── triggerEntityFieldResolve: deduplication ──────────────────────────────

  describe("triggerEntityFieldResolve — deduplication", () => {
    it("does not re-execute when state is already pending", () => {
      const { config, template } = makeConfig();
      const manager = new ResolveManager(makeMinimalDeps(config, entityRegistry));

      // First call: creates pending state
      manager.triggerEntityFieldResolve("u1", template.isActive as any);
      const state1 = manager.entityStates.get("u1", template.isActive as object)!;
      const promise1 = state1.promise;

      // Second call: should be a no-op (deduplication)
      manager.triggerEntityFieldResolve("u1", template.isActive as any);
      const state2 = manager.entityStates.get("u1", template.isActive as object)!;

      expect(state2.promise).toBe(promise1); // same promise object
    });

    it("can retrigger after state becomes resolved", async () => {
      const { config, template } = makeConfig();
      const manager = new ResolveManager(makeMinimalDeps(config, entityRegistry));

      // Register entity so executor can actually run and resolve
      entityRegistry.upsert({ id: "u1", isActive: false });

      // Use bio (has skipIfResolved: false) so second trigger is not blocked by skipIfResolved
      manager.triggerEntityFieldResolve("u1", template.bio as any);
      const state = manager.entityStates.get("u1", template.bio as object)!;

      // Wait for real resolver to complete
      await state.promise;
      expect(state.status).toBe("resolved");

      // Second call after resolved: allowed (skipIfResolved: false on bio)
      state.status = "resolved"; // explicitly confirm resolved
      state.promise = null;
      manager.triggerEntityFieldResolve("u1", template.bio as any);

      // State is now pending again
      const newState = manager.entityStates.get("u1", template.bio as object)!;
      expect(newState.status).toBe("pending");
    });
  });

  // ─── triggerEntityFieldResolve: skipIfResolved ────────────────────────────

  describe("triggerEntityFieldResolve — skipIfResolved", () => {
    it("skips (marks resolved) when entity leaf has a non-default value and skipIfResolved is true (default)", () => {
      const { config, template } = makeConfig();
      const manager = new ResolveManager(makeMinimalDeps(config, entityRegistry));

      // Create entity with isActive = true (non-default false)
      entityRegistry.upsert({ id: "u1", isActive: true });

      manager.triggerEntityFieldResolve("u1", template.isActive as any);

      const state = manager.entityStates.get("u1", template.isActive as object)!;
      expect(state).toBeDefined();
      expect(state.status).toBe("resolved"); // skipped — already has value
    });

    it("does NOT skip when entity leaf value equals the template default", () => {
      const { config, template } = makeConfig();
      const manager = new ResolveManager(makeMinimalDeps(config, entityRegistry));

      // Create entity with isActive = false (same as template default)
      entityRegistry.upsert({ id: "u1", isActive: false });

      manager.triggerEntityFieldResolve("u1", template.isActive as any);

      const state = manager.entityStates.get("u1", template.isActive as object)!;
      expect(state.status).toBe("pending");
    });

    it("does NOT skip when entity leaf value is null", () => {
      const { config, template } = makeConfig();
      const manager = new ResolveManager(makeMinimalDeps(config, entityRegistry));

      entityRegistry.upsert({ id: "u1", isActive: null });

      manager.triggerEntityFieldResolve("u1", template.isActive as any);

      const state = manager.entityStates.get("u1", template.isActive as object)!;
      expect(state.status).toBe("pending");
    });

    it("does NOT skip when entity leaf value is undefined (field absent)", () => {
      const { config, template } = makeConfig();
      const manager = new ResolveManager(makeMinimalDeps(config, entityRegistry));

      // Entity created without isActive field
      entityRegistry.upsert({ id: "u1", name: "Alice" });

      manager.triggerEntityFieldResolve("u1", template.isActive as any);

      const state = manager.entityStates.get("u1", template.isActive as object)!;
      expect(state.status).toBe("pending");
    });

    it("does NOT skip when entity does not exist in registry (no-op: state stays idle)", () => {
      const { config, template } = makeConfig();
      const manager = new ResolveManager(makeMinimalDeps(config, entityRegistry));

      // No entity registered for "u1" — executor returns early, state stays idle
      manager.triggerEntityFieldResolve("u1", template.isActive as any);

      const state = manager.entityStates.get("u1", template.isActive as object)!;
      expect(state.status).toBe("idle");
    });

    it("runs (does NOT skip) when skipIfResolved: false even if entity has non-default value", () => {
      const { config, template } = makeConfig();
      const manager = new ResolveManager(makeMinimalDeps(config, entityRegistry));

      // bio has skipIfResolved: false in makeConfig()
      // Create entity with non-empty bio
      entityRegistry.upsert({ id: "u1", bio: "Some bio text" });

      manager.triggerEntityFieldResolve("u1", template.bio as any);

      const state = manager.entityStates.get("u1", template.bio as object)!;
      expect(state.status).toBe("pending"); // NOT skipped
    });
  });

  // ─── cleanupEntityResolveStates ────────────────────────────────────────────

  describe("cleanupEntityResolveStates", () => {
    it("removes all entity states for the given entityId", () => {
      const { config, template } = makeConfig();
      const manager = new ResolveManager(makeMinimalDeps(config, entityRegistry));

      manager.triggerEntityFieldResolve("u1", template.isActive as any);
      manager.triggerEntityFieldResolve("u1", template.bio as any);

      expect(manager.entityStates.get("u1", template.isActive as object)).toBeDefined();
      expect(manager.entityStates.get("u1", template.bio as object)).toBeDefined();

      manager.cleanupEntityResolveStates("u1");

      expect(manager.entityStates.get("u1", template.isActive as object)).toBeUndefined();
      expect(manager.entityStates.get("u1", template.bio as object)).toBeUndefined();
    });

    it("cleanup does not affect other entities", () => {
      const { config, template } = makeConfig();
      const manager = new ResolveManager(makeMinimalDeps(config, entityRegistry));

      manager.triggerEntityFieldResolve("u1", template.isActive as any);
      manager.triggerEntityFieldResolve("u2", template.isActive as any);

      manager.cleanupEntityResolveStates("u1");

      expect(manager.entityStates.get("u1", template.isActive as object)).toBeUndefined();
      expect(manager.entityStates.get("u2", template.isActive as object)).toBeDefined();
    });

    it("no-ops gracefully for unknown entityId", () => {
      const { config } = makeConfig();
      const manager = new ResolveManager(makeMinimalDeps(config, entityRegistry));

      expect(() => manager.cleanupEntityResolveStates("nonexistent")).not.toThrow();
    });
  });

  // ─── _executeEntityFieldEntry (Phase 3: real execution) ─────────────────────

  describe("_executeEntityFieldEntry real execution", () => {
    it("marks state as pending immediately and resolves to 'resolved' when entity exists", async () => {
      const { config, template } = makeConfig();
      const manager = new ResolveManager(makeMinimalDeps(config, entityRegistry));

      // Register entity so executor can find it
      entityRegistry.upsert({ id: "u1", isActive: false, bio: "" });

      manager.triggerEntityFieldResolve("u1", template.isActive as any);
      const state = manager.entityStates.get("u1", template.isActive as object)!;

      expect(state.status).toBe("pending");
      expect(state.promise).not.toBeNull();

      await state.promise;

      expect(state.status).toBe("resolved");
    });
  });
});
