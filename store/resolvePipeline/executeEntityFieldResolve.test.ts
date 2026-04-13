/**
 * Phase 3 tests: executeEntityFieldResolve — real async execution.
 *
 * Covers:
 * - resolver called with current entity values (built from entityNode) and store
 * - result written to entity leaf (nodeState + entityNode.field.value)
 * - loading lifecycle: status = "pending" while running, nodeState loading = true/false
 * - recomputeAndNotify called on loading start and on completion
 * - auto-deps: accessed entity field paths saved in entityStates.dependencies
 * - context auto-deps: $context.xxx paths saved when resolver accesses store.context
 * - retry: resolver fails, retries, then succeeds
 * - error path: onError called, status = "error", loading = false after retries exhausted
 * - pendingRetrigger: if set true while pending, retriggers after completion
 * - status change during pending (external abort) → no further writes
 * - deduplication: calling with status=pending returns same promise
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeEntityFieldResolve } from "./executeEntityFieldResolve";
import type { EntityFieldResolveDeps } from "./executeEntityFieldResolve";
import { EntityResolveStateMap } from "./types";
import type { TemplateFieldResolveEntry } from "./initResolveStates";
import type { EntityNode } from "../entityRegistry/types";
import type { FieldState } from "../compute/index";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function flushPromises(times = 1) {
  for (let i = 0; i < times; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

function makeFieldState(value: unknown, loading = false): FieldState {
  return {
    value,
    isVisible: true,
    isRequired: false,
    isDisabled: false,
    isReadOnly: false,
    loading,
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

function makeSetup(resolverImpl?: (...args: any[]) => Promise<unknown>, onError?: (...args: any[]) => void) {
  const resolver = vi.fn<(values: any, store: any) => Promise<any>>(resolverImpl ?? (async () => true));
  const onErrorFn = vi.fn<(error: unknown, ctx: any) => void>(onError ?? (() => {}));
  const notifyChanged = vi.fn();
  const recompute = vi.fn(() => new Set<object>());
  const notify = vi.fn();

  // Entity node: { id: { value: "u1" }, isActive: { value: false }, name: { value: "Alice" } }
  const entityNode: EntityNode = {
    id: { value: "u1" },
    isActive: { value: false },
    name: { value: "Alice" },
  };

  // Template field with resolve
  const templateField = { value: false };

  // TemplateFieldResolveEntry for "isActive"
  const entry: TemplateFieldResolveEntry = {
    node: templateField as any,
    resolve: {
      resolver,
      onError: onErrorFn,
    },
    isListNode: false,
    isTemplateField: true,
    listNode: {} as any,
    fieldKey: "isActive",
  };

  // Register entity leaf in nodeState
  const nodeState = new WeakMap<object, FieldState>();
  nodeState.set(entityNode.isActive as object, makeFieldState(false));

  const entityStates = new EntityResolveStateMap();

  const deps: EntityFieldResolveDeps = {
    rootConfig: {} as any,
    nodeState,
    resolveStates: new Map(),
    recompute,
    notifyChanged,
    notify,
    getValues: () => ({}),
    initialValueMap: new WeakMap(),
    valuesCache: { values: {}, nodeSlot: new WeakMap(), groupSlot: new WeakMap() },
    store: { context: {} } as any,
    entityStates,
  };

  return { entityNode, entry, templateField, nodeState, entityStates, deps, resolver, onErrorFn, notifyChanged, recompute, notify };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("executeEntityFieldResolve — basic execution", () => {
  it("resolver is called with entity values (flat object from entityNode)", async () => {
    const { entityNode, entry, entityStates, deps, resolver } = makeSetup();

    executeEntityFieldResolve("u1", entry, entityNode, deps);
    await flushPromises();

    expect(resolver).toHaveBeenCalledTimes(1);
    const [calledValues] = resolver.mock.calls[0];
    // Entity values built from entityNode: { id: "u1", isActive: false, name: "Alice" }
    expect(calledValues.id).toBe("u1");
    expect(calledValues.isActive).toBe(false);
    expect(calledValues.name).toBe("Alice");
  });

  it("resolver is called with the store as second argument", async () => {
    const { entityNode, entry, deps, resolver } = makeSetup();

    executeEntityFieldResolve("u1", entry, entityNode, deps);
    await flushPromises();

    expect(resolver).toHaveBeenCalledTimes(1);
    const [, calledStore] = resolver.mock.calls[0];
    // The storeProxy wraps deps.store — verify it's proxy-shaped
    expect(calledStore).toBeDefined();
  });

  it("resolved value is written to entityNode.field.value", async () => {
    const { entityNode, entry, deps } = makeSetup(async () => true);

    executeEntityFieldResolve("u1", entry, entityNode, deps);
    await flushPromises();

    expect((entityNode.isActive as any).value).toBe(true);
  });

  it("resolved value is written to entity leaf nodeState", async () => {
    const { entityNode, entry, deps, nodeState } = makeSetup(async () => true);

    executeEntityFieldResolve("u1", entry, entityNode, deps);
    await flushPromises();

    const leafState = nodeState.get(entityNode.isActive as object);
    expect(leafState?.value).toBe(true);
  });

  it("undefined result does NOT overwrite entity leaf", async () => {
    const { entityNode, entry, deps, nodeState } = makeSetup(async () => undefined);

    executeEntityFieldResolve("u1", entry, entityNode, deps);
    await flushPromises();

    // undefined result → leaf unchanged
    expect((entityNode.isActive as any).value).toBe(false);
    const leafState = nodeState.get(entityNode.isActive as object);
    expect(leafState?.value).toBe(false);
  });
});

// ─── Loading lifecycle ─────────────────────────────────────────────────────────

describe("executeEntityFieldResolve — loading lifecycle", () => {
  it("entityStates.status = 'pending' while resolver running", async () => {
    let resolvePromise!: (v: unknown) => void;
    const { entityNode, entry, entityStates, deps } = makeSetup(
      () => new Promise((r) => { resolvePromise = r; }),
    );

    executeEntityFieldResolve("u1", entry, entityNode, deps);

    const state = entityStates.get("u1", entry.node as object)!;
    expect(state.status).toBe("pending");

    resolvePromise(true);
    await flushPromises();

    expect(state.status).toBe("resolved");
  });

  it("nodeState loading = true while resolver running, false after", async () => {
    let resolvePromise!: (v: unknown) => void;
    const { entityNode, entry, deps, nodeState } = makeSetup(
      () => new Promise((r) => { resolvePromise = r; }),
    );

    executeEntityFieldResolve("u1", entry, entityNode, deps);

    const leafState = nodeState.get(entityNode.isActive as object)!;
    expect(leafState.loading).toBe(true);

    resolvePromise(true);
    await flushPromises();

    const leafStateAfter = nodeState.get(entityNode.isActive as object)!;
    expect(leafStateAfter.loading).toBe(false);
  });

  it("recomputeAndNotify called at start (loading=true) and after success", async () => {
    let resolvePromise!: (v: unknown) => void;
    const { entityNode, entry, deps, notifyChanged } = makeSetup(
      () => new Promise((r) => { resolvePromise = r; }),
    );

    notifyChanged.mockClear();

    executeEntityFieldResolve("u1", entry, entityNode, deps);
    expect(notifyChanged).toHaveBeenCalledTimes(1); // loading=true notification

    resolvePromise(true);
    await flushPromises();
    expect(notifyChanged).toHaveBeenCalledTimes(2); // completion notification
  });

  it("notifyChanged receives changed set containing entity leaf", async () => {
    const { entityNode, entry, deps, notifyChanged } = makeSetup(async () => true);

    notifyChanged.mockClear();

    executeEntityFieldResolve("u1", entry, entityNode, deps);
    await flushPromises();

    // Second call = success notification; check entity leaf is in the changed set
    const lastCall = notifyChanged.mock.calls[notifyChanged.mock.calls.length - 1];
    const changedSet = lastCall[0] as Set<object>;
    expect(changedSet.has(entityNode.isActive as object)).toBe(true);
  });
});

// ─── Auto-deps tracking ──────────────────────────────────────────────────────

describe("executeEntityFieldResolve — auto-deps", () => {
  it("auto-deps saved in entityStates.dependencies from accessed entity fields", async () => {
    const { entityNode, entry, entityStates, deps } = makeSetup(
      async (values: any) => {
        // Read 'name' → should be tracked as dep
        void values.name;
        return true;
      },
    );

    // Override resolver to read 'name' field
    const resolver = vi.fn(async (values: any) => {
      void values.name;
      return true;
    });
    (entry.resolve as any).resolver = resolver;

    executeEntityFieldResolve("u1", entry, entityNode, deps);
    await flushPromises();

    const state = entityStates.get("u1", entry.node as object)!;
    expect(state.dependencies.has("name")).toBe(true);
  });

  it("explicit deps from resolve.deps are included in dependencies", async () => {
    const { entityNode, entry, entityStates, deps } = makeSetup(async () => true);
    (entry.resolve as any).deps = ["someField"];

    executeEntityFieldResolve("u1", entry, entityNode, deps);
    await flushPromises();

    const state = entityStates.get("u1", entry.node as object)!;
    expect(state.dependencies.has("someField")).toBe(true);
  });

  it("context auto-deps ($context.xxx) saved when resolver accesses store.context", async () => {
    const { entityNode, entry, entityStates, deps } = makeSetup();

    const contextStore = { context: { accountId: "acct1" } };
    (deps as any).store = contextStore;

    // Override resolver to read context.accountId
    (entry.resolve as any).resolver = vi.fn(async (_vals: any, store: any) => {
      void store.context.accountId;
      return true;
    });

    executeEntityFieldResolve("u1", entry, entityNode, deps);
    await flushPromises();

    const state = entityStates.get("u1", entry.node as object)!;
    expect(state.dependencies.has("$context.accountId")).toBe(true);
  });
});

// ─── Error path ───────────────────────────────────────────────────────────────

describe("executeEntityFieldResolve — error handling", () => {
  it("onError called after resolver throws", async () => {
    const error = new Error("resolve failed");
    const { entityNode, entry, deps, onErrorFn } = makeSetup(async () => {
      throw error;
    });

    executeEntityFieldResolve("u1", entry, entityNode, deps);
    await flushPromises();

    expect(onErrorFn).toHaveBeenCalledTimes(1);
    expect(onErrorFn.mock.calls[0][0]).toBe(error);
  });

  it("status = 'error' and loading = false after error", async () => {
    const { entityNode, entry, entityStates, deps, nodeState } = makeSetup(async () => {
      throw new Error("fail");
    });

    executeEntityFieldResolve("u1", entry, entityNode, deps);
    await flushPromises();

    const state = entityStates.get("u1", entry.node as object)!;
    expect(state.status).toBe("error");
    expect(state.error).toBeInstanceOf(Error);

    const leafState = nodeState.get(entityNode.isActive as object)!;
    expect(leafState.loading).toBe(false);
  });

  it("notify (from deps) is passed to onError ctx.notify", async () => {
    const { entityNode, entry, deps, onErrorFn, notify } = makeSetup(async () => {
      throw new Error("fail");
    });

    executeEntityFieldResolve("u1", entry, entityNode, deps);
    await flushPromises();

    expect(onErrorFn).toHaveBeenCalledTimes(1);
    const ctx = onErrorFn.mock.calls[0][1];
    expect(ctx.notify).toBe(notify);
  });

  it("recomputeAndNotify called on error (loading=false notification)", async () => {
    const { entityNode, entry, deps, notifyChanged } = makeSetup(async () => {
      throw new Error("fail");
    });

    notifyChanged.mockClear();

    executeEntityFieldResolve("u1", entry, entityNode, deps);
    await flushPromises();

    // Called twice: once for loading=true at start, once for error
    expect(notifyChanged).toHaveBeenCalledTimes(2);
  });

  it("context deps saved even on error path", async () => {
    const { entityNode, entry, entityStates, deps } = makeSetup();

    (deps as any).store = { context: { tenantId: "t1" } };
    (entry.resolve as any).resolver = vi.fn(async (_vals: any, store: any) => {
      void store.context.tenantId;
      throw new Error("fail");
    });

    executeEntityFieldResolve("u1", entry, entityNode, deps);
    await flushPromises();

    const state = entityStates.get("u1", entry.node as object)!;
    expect(state.dependencies.has("$context.tenantId")).toBe(true);
  });
});

// ─── Retry ────────────────────────────────────────────────────────────────────

describe("executeEntityFieldResolve — retry", () => {
  it("retries on error up to resolve.options.retry.attempts times", async () => {
    const resolver = vi.fn()
      .mockRejectedValueOnce(new Error("attempt 1 fail"))
      .mockRejectedValueOnce(new Error("attempt 2 fail"))
      .mockResolvedValue(true);

    const { entityNode, entry, entityStates, deps } = makeSetup();
    (entry.resolve as any).resolver = resolver;
    (entry.resolve as any).options = { retry: { attempts: 2, delay: 0 } };

    executeEntityFieldResolve("u1", entry, entityNode, deps);
    await flushPromises(10); // multiple flushes for retry delays (delay: 0)

    expect(resolver).toHaveBeenCalledTimes(3); // initial + 2 retries

    const state = entityStates.get("u1", entry.node as object)!;
    expect(state.status).toBe("resolved");
  });

  it("status = 'error' if all retry attempts fail", async () => {
    const resolver = vi.fn().mockRejectedValue(new Error("always fails"));
    const { entityNode, entry, entityStates, deps, onErrorFn } = makeSetup();
    (entry.resolve as any).resolver = resolver;
    (entry.resolve as any).options = { retry: { attempts: 1, delay: 0 } };

    executeEntityFieldResolve("u1", entry, entityNode, deps);
    await flushPromises(10); // multiple flushes for retry delays (delay: 0)

    expect(resolver).toHaveBeenCalledTimes(2); // initial + 1 retry
    expect(onErrorFn).toHaveBeenCalledTimes(1);

    const state = entityStates.get("u1", entry.node as object)!;
    expect(state.status).toBe("error");
  });
});

// ─── Deduplication ────────────────────────────────────────────────────────────

describe("executeEntityFieldResolve — deduplication", () => {
  it("returns same promise if status is already pending", async () => {
    let resolvePromise!: (v: unknown) => void;
    const { entityNode, entry, entityStates, deps } = makeSetup(
      () => new Promise((r) => { resolvePromise = r; }),
    );

    const p1 = executeEntityFieldResolve("u1", entry, entityNode, deps);
    const state = entityStates.get("u1", entry.node as object)!;
    state.promise = p1; // promise already set by first call

    const p2 = executeEntityFieldResolve("u1", entry, entityNode, deps);
    expect(p2).toBe(p1);

    resolvePromise(true);
    await flushPromises();
  });

  it("can execute again after status becomes 'resolved'", async () => {
    const { entityNode, entry, entityStates, deps, resolver } = makeSetup(async () => true);

    executeEntityFieldResolve("u1", entry, entityNode, deps);
    await flushPromises();

    const state = entityStates.get("u1", entry.node as object)!;
    expect(state.status).toBe("resolved");

    // Reset state manually to idle to allow re-execution (as triggerEntityFieldResolve would)
    state.status = "idle";
    state.promise = null;

    executeEntityFieldResolve("u1", entry, entityNode, deps);
    await flushPromises();

    expect(resolver).toHaveBeenCalledTimes(2);
  });
});

// ─── pendingRetrigger ───────────────────────────────────────────────────────

describe("executeEntityFieldResolve — pendingRetrigger", () => {
  it("retriggers after completion if pendingRetrigger was set while pending", async () => {
    let resolveFirst!: (v: unknown) => void;
    let callCount = 0;
    const resolver = vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        return new Promise((r) => { resolveFirst = r; });
      }
      return Promise.resolve(true);
    });

    const { entityNode, entry, entityStates, deps } = makeSetup();
    (entry.resolve as any).resolver = resolver;

    executeEntityFieldResolve("u1", entry, entityNode, deps);

    // Set pendingRetrigger while first resolve is running
    const state = entityStates.get("u1", entry.node as object)!;
    expect(state.status).toBe("pending");
    state.pendingRetrigger = true;

    // Complete first resolve
    resolveFirst(false);
    await flushPromises();

    // Should retrigger → resolver called again
    expect(resolver).toHaveBeenCalledTimes(2);
  });
});

// ─── External abort (status changed during pending) ──────────────────────────

describe("executeEntityFieldResolve — external abort", () => {
  it("does not write result if status changed to 'idle' during pending", async () => {
    let resolvePromise!: (v: unknown) => void;
    const { entityNode, entry, entityStates, deps } = makeSetup(
      () => new Promise((r) => { resolvePromise = r; }),
    );

    executeEntityFieldResolve("u1", entry, entityNode, deps);

    // Simulate external abort (e.g. entity deleted)
    const state = entityStates.get("u1", entry.node as object)!;
    state.status = "idle";

    resolvePromise(true);
    await flushPromises();

    // Result should NOT be written (status was changed externally)
    expect((entityNode.isActive as any).value).toBe(false);
  });
});
