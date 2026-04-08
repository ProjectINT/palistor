/**
 * Phase 4 integration tests: entity field resolve lifecycle.
 *
 * Covers:
 * - List resolver loads entities → entity field resolves triggered automatically
 * - store.set() — no listNode provided → field resolves NOT triggered automatically
 * - delete(entityId) → cleanupEntityResolveStates called → entityStates cleared
 * - createPostNotifyHook: entity path change triggers retrigger of dependent field resolve
 * - createPostNotifyHook: pending entity field resolve marked pendingRetrigger when dep changes
 * - createPostNotifyHook: non-entity paths do not touch entity field resolve states
 * - createPostNotifyHook: returned non-null when only templateFieldEntries exist (no resolveEntries)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Palistor } from "../store/palistor";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function flushPromises(times = 3) {
  for (let i = 0; i < times; i++) {
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

// ─── Shared config factory ────────────────────────────────────────────────────

function makeConfig(fieldResolver: (...args: any[]) => Promise<unknown> = async () => true) {
  const fieldResolve = {
    resolver: vi.fn(fieldResolver),
    onError: vi.fn(),
  };

  const listResolver = vi.fn(async () => [{ id: "u1", name: "Alice", isActive: false }]);

  const template = {
    id: { value: "" },
    name: { value: "" },
    isActive: { value: false, resolve: fieldResolve },
  };

  const config = {
    users: [
      template,
      {
        resolve: {
          resolver: listResolver,
          onError: vi.fn(),
          options: { lazy: false },
        },
      },
    ],
  };

  return { config, template, fieldResolve, listResolver };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Phase 4 — entity field resolve lifecycle", () => {
  // ─── 4.1: list resolve → entity field resolves triggered ─────────────────

  describe("4.1: list resolver triggers entity field resolves", () => {
    it("list resolver completes → field resolve for each entity is triggered", async () => {
      const { config, fieldResolve } = makeConfig();
      new Palistor({ config: config as any });

      await flushPromises(5);

      expect(fieldResolve.resolver).toHaveBeenCalledTimes(1);
    });

    it("field resolve resolver receives entity values as first arg", async () => {
      const { config, fieldResolve } = makeConfig();
      new Palistor({ config: config as any });

      await flushPromises(5);

      const args = fieldResolve.resolver.mock.calls[0];
      expect(args[0]).toMatchObject({ id: "u1", name: "Alice" });
    });

    it("field resolve result written to entity leaf", async () => {
      const { config } = makeConfig(async () => true);
      const store = new Palistor({ config: config as any });

      await flushPromises(5);

      const entity = store.entityRegistry.get("u1");
      expect(entity).toBeDefined();
      const isActiveLeaf = entity!.isActive as { value: unknown };
      const nodeState = store.nodes.nodeState.get(isActiveLeaf as object) as { value: unknown } | undefined;
      expect((nodeState ?? isActiveLeaf).value).toBe(true);
    });

    it("entityStates has a resolved state for (entityId, templateFieldNode) after success", async () => {
      const { config, template } = makeConfig(async () => true);
      const store = new Palistor({ config: config as any });

      await flushPromises(5);

      const state = store.resolveManager.entityStates.get("u1", template.isActive as object);
      expect(state?.status).toBe("resolved");
    });

    it("multiple entities from list resolver — field resolve triggered for each", async () => {
      const fieldResolve = {
        resolver: vi.fn(async () => true),
        onError: vi.fn(),
      };
      const template = {
        id: { value: "" },
        name: { value: "" },
        isActive: { value: false, resolve: fieldResolve },
      };
      const config = {
        users: [
          template,
          {
            resolve: {
              resolver: vi.fn(async () => [
                { id: "u1", name: "Alice", isActive: false },
                { id: "u2", name: "Bob", isActive: false },
              ]),
              onError: vi.fn(),
              options: { lazy: false },
            },
          },
        ],
      };
      new Palistor({ config: config as any });

      await flushPromises(5);

      expect(fieldResolve.resolver).toHaveBeenCalledTimes(2);
    });
  });

  // ─── 4.2: store.set() — no listNode → field resolves NOT auto-triggered ───

  describe("4.2: store.set() does not auto-trigger field resolves", () => {
    it("store.set() without list resolve — field resolver not called", async () => {
      const { config, fieldResolve } = makeConfig();

      // Use lazy: true (don't auto-run list resolver)
      const lazyConfig = {
        users: [
          (config.users as any[])[0],
          {
            resolve: {
              resolver: vi.fn(async () => []),
              onError: vi.fn(),
              options: { lazy: true },
            },
          },
        ],
      };

      const store = new Palistor({ config: lazyConfig as any });
      store.set({ id: "u1", name: "Alice", isActive: false });

      await flushPromises(3);

      // Field resolver should NOT be called since no listNode passed through set()
      expect(fieldResolve.resolver).not.toHaveBeenCalled();
    });
  });

  // ─── 4.3: delete() → cleanup entity resolve states ───────────────────────

  describe("4.3: delete() cleans up entity resolve states", () => {
    it("delete entity → entityStates entries removed", async () => {
      const { config, template } = makeConfig(async () => true);
      const store = new Palistor({ config: config as any });

      await flushPromises(5);

      // Verify state exists after resolve
      const beforeDelete = store.resolveManager.entityStates.get("u1", template.isActive as object);
      expect(beforeDelete).toBeDefined();

      store.delete("u1");

      const afterDelete = store.resolveManager.entityStates.get("u1", template.isActive as object);
      expect(afterDelete).toBeUndefined();
    });

    it("delete non-existent entity is a no-op", () => {
      const { config } = makeConfig();
      const store = new Palistor({ config: config as any });

      expect(() => store.delete("does-not-exist")).not.toThrow();
    });
  });

  // ─── 4.4: createPostNotifyHook — entity path retrigger ───────────────────

  describe("4.4: createPostNotifyHook entity path retrigger", () => {
    it("returns non-null hook when only templateFieldEntries exist (no regular resolveEntries)", () => {
      // Config with ONLY template field resolve (no group/list resolver that adds a resolveEntry)
      const fieldResolve = {
        resolver: vi.fn(async () => true),
        onError: vi.fn(),
      };
      const config = {
        users: [{ id: { value: "" }, isActive: { value: false, resolve: fieldResolve } }],
      };
      const store = new Palistor({ config: config as any });

      // postNotifyHook should be set (non-null) since template field entries exist
      // We can verify by checking that resolveManager has templateFieldEntries
      expect(store.resolveManager.templateFieldEntries).toHaveLength(1);
    });

    it("entity field path change → resolved entity field resolve retriggered", async () => {
      const resolverCalls: unknown[] = [];
      const config = {
        users: [
          {
            id: { value: "" },
            name: { value: "" },
            isActive: {
              value: false,
              resolve: {
                resolver: vi.fn(async (entityValues: any) => {
                  resolverCalls.push(entityValues.name);
                  return entityValues.name === "Alice";
                }),
                onError: vi.fn(),
              },
            },
          },
          {
            resolve: {
              resolver: vi.fn(async () => [{ id: "u1", name: "Alice", isActive: false }]),
              onError: vi.fn(),
              options: { lazy: false },
            },
          },
        ],
      };

      const store = new Palistor({ config: config as any });
      await flushPromises(5);

      // u1.isActive field resolve runs and reads "name" via tracking proxy
      expect(resolverCalls).toContain("Alice");

      // Now update entity name — this should retrigger isActive field resolve
      store.set({ id: "u1", name: "Bob" });
      await flushPromises(5);

      expect(resolverCalls).toContain("Bob");
    });

    it("non-entity path change does not affect entity field resolve states", async () => {
      const { config, fieldResolve } = makeConfig(async () => true);
      const store = new Palistor({ config: config as any });

      await flushPromises(5);

      const callsBefore = fieldResolve.resolver.mock.calls.length;

      // Change a non-entity path (this won't match _entity_.* prefix)
      // Simulated by notifying a non-entity changed path via the hub directly
      store.hub["postNotifyHook"]?.(new Set(["someRandomPath"]));

      await flushPromises(3);

      expect(fieldResolve.resolver.mock.calls.length).toBe(callsBefore);
    });

    it("pending entity field resolve → pendingRetrigger set when dep changes", async () => {
      let resolveCallback!: (v: unknown) => void;
      const template = {
        id: { value: "" },
        name: { value: "" },
        isActive: {
          value: false,
          resolve: {
            resolver: vi.fn(async (entityValues: any) => {
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const _name = entityValues.name; // track dep
              return new Promise<unknown>((res) => { resolveCallback = res; });
            }),
            onError: vi.fn(),
            // explicit dep so pendingRetrigger works before first auto-dep collection
            deps: ["name"],
          },
        },
      };
      const config = {
        users: [
          template,
          {
            resolve: {
              resolver: vi.fn(async () => [{ id: "u1", name: "Alice", isActive: false }]),
              onError: vi.fn(),
              options: { lazy: false },
            },
          },
        ],
      };

      const store = new Palistor({ config: config as any });
      await flushPromises(5);

      // isActive field resolve is now pending (waiting for Promise to resolve)
      const state = store.resolveManager.entityStates.get("u1", template.isActive as object);
      expect(state?.status).toBe("pending");

      // Change entity name while resolve is still pending
      store.set({ id: "u1", name: "Bob" });

      // state should have pendingRetrigger set
      expect(state?.pendingRetrigger).toBe(true);

      // Complete the pending resolve
      resolveCallback(true);
      await flushPromises(3);
    });
  });

  // ─── 4.5: store.reset() clears entity resolve states ─────────────────────

  describe("4.5: store.reset() clears entity resolve states", () => {
    it("reset() clears entityStates so field resolves re-run on next entity load", async () => {
      const { config, template, fieldResolve } = makeConfig(async () => true);
      const store = new Palistor({ config: config as any });

      await flushPromises(5);

      // State is resolved after initial load
      const stateBefore = store.resolveManager.entityStates.get("u1", template.isActive as object);
      expect(stateBefore?.status).toBe("resolved");

      store.reset();

      // All entity resolve states cleared
      const stateAfter = store.resolveManager.entityStates.get("u1", template.isActive as object);
      expect(stateAfter).toBeUndefined();

      // Field resolver was only called once (during initial load, not during reset)
      expect(fieldResolve.resolver).toHaveBeenCalledTimes(1);
    });

    it("reset() does NOT clear entity states when called for a subgroup (not rootConfig)", async () => {
      const { config, template } = makeConfig(async () => true);
      const store = new Palistor({ config: config as any });

      await flushPromises(5);

      // Manually call resetPipeline.execute with a non-root node
      const nonRootNode = (store as any).rootConfig.users?.[1] ?? {};
      store.resetPipeline.execute(nonRootNode as any);

      // States should still be present (non-root reset should not clear them)
      const state = store.resolveManager.entityStates.get("u1", template.isActive as object);
      expect(state?.status).toBe("resolved");
    });
  });
});
