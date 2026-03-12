import { describe, it, expect, vi } from "vitest";
import { handleLazyResolve } from "./handleLazyResolve";
import type { AnyConfigNode } from "../types";
import type { ResolveState } from "../resolvePipeline";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeResolveState(overrides: Partial<ResolveState> = {}): ResolveState {
  return {
    status: "idle",
    promise: null,
    error: null,
    dependencies: new Set(),
    attempt: 0,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("handleLazyResolve", () => {
  it("does nothing if triggerResolve is not provided", () => {
    const node: AnyConfigNode = { resolve: { resolver: async () => ({}) } };
    // Should not throw
    handleLazyResolve(node, { triggerResolve: undefined, getResolveState: undefined });
  });

  it("does nothing if node has no resolve config", () => {
    const trigger = vi.fn();
    const node: AnyConfigNode = { email: { value: "" } };
    handleLazyResolve(node, {
      triggerResolve: trigger,
      getResolveState: () => makeResolveState(),
    });
    expect(trigger).not.toHaveBeenCalled();
  });

  it("does nothing if getResolveState returns undefined", () => {
    const trigger = vi.fn();
    const node: AnyConfigNode = { resolve: { resolver: async () => ({}) } };
    handleLazyResolve(node, {
      triggerResolve: trigger,
      getResolveState: () => undefined,
    });
    expect(trigger).not.toHaveBeenCalled();
  });

  it("triggers resolve when status is idle", () => {
    const trigger = vi.fn();
    const node: AnyConfigNode = { resolve: { resolver: async () => ({}) } };
    handleLazyResolve(node, {
      triggerResolve: trigger,
      getResolveState: () => makeResolveState({ status: "idle" }),
    });
    expect(trigger).toHaveBeenCalledWith(node);
  });

  it("does not trigger resolve when status is pending", () => {
    const trigger = vi.fn();
    const node: AnyConfigNode = { resolve: { resolver: async () => ({}) } };
    handleLazyResolve(node, {
      triggerResolve: trigger,
      getResolveState: () => makeResolveState({ status: "pending", promise: Promise.resolve() }),
    });
    expect(trigger).not.toHaveBeenCalled();
  });

  it("throws promise when pending + suspense enabled", () => {
    const pendingPromise = new Promise(() => {}); // never resolves
    const node: AnyConfigNode = {
      resolve: { resolver: async () => ({}), options: { suspense: true } },
    };
    let thrown: unknown;
    try {
      handleLazyResolve(node, {
        triggerResolve: vi.fn(),
        getResolveState: () => makeResolveState({ status: "pending", promise: pendingPromise }),
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(pendingPromise);
  });

  it("does not throw when pending + suspense disabled", () => {
    const node: AnyConfigNode = {
      resolve: { resolver: async () => ({}), options: { suspense: false } },
    };
    expect(() => {
      handleLazyResolve(node, {
        triggerResolve: vi.fn(),
        getResolveState: () =>
          makeResolveState({ status: "pending", promise: Promise.resolve() }),
      });
    }).not.toThrow();
  });

  it("does not throw when pending but promise is null", () => {
    const node: AnyConfigNode = {
      resolve: { resolver: async () => ({}), options: { suspense: true } },
    };
    expect(() => {
      handleLazyResolve(node, {
        triggerResolve: vi.fn(),
        getResolveState: () => makeResolveState({ status: "pending", promise: null }),
      });
    }).not.toThrow();
  });
});
