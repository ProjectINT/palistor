import { describe, it, expect } from "vitest";
import { createContextTrackingProxy } from "./createContextTrackingProxy";

describe("createContextTrackingProxy", () => {
  it("returns the value for a read key", () => {
    const ctx = { accountId: "acc-1", tenant: "acme" };
    const { proxy } = createContextTrackingProxy(ctx);
    expect(proxy["accountId"]).toBe("acc-1");
  });

  it("reading a key adds it to accessedKeys", () => {
    const ctx = { accountId: "acc-1" };
    const { proxy, getAccessedKeys } = createContextTrackingProxy(ctx);
    void proxy["accountId"];
    expect(getAccessedKeys()).toContain("accountId");
  });

  it("reading multiple keys tracks all of them", () => {
    const ctx = { accountId: "acc-1", tenant: "acme", locale: "en" };
    const { proxy, getAccessedKeys } = createContextTrackingProxy(ctx);
    void proxy["accountId"];
    void proxy["tenant"];
    const keys = getAccessedKeys();
    expect(keys).toContain("accountId");
    expect(keys).toContain("tenant");
    expect(keys.size).toBe(2);
  });

  it("symbol keys are not tracked", () => {
    const sym = Symbol("test");
    const ctx = Object.assign({ accountId: "x" }, { [sym]: "sym-val" });
    const { proxy, getAccessedKeys } = createContextTrackingProxy(ctx as Record<string, unknown>);
    // Access symbol key — should not throw and not be tracked
    void (proxy as any)[sym];
    expect(getAccessedKeys().size).toBe(0);
  });

  it("does not track undefined keys as special — still returns undefined", () => {
    const ctx = { accountId: "acc-1" } as Record<string, unknown>;
    const { proxy, getAccessedKeys } = createContextTrackingProxy(ctx);
    const val = proxy["nonExistent"];
    expect(val).toBeUndefined();
    // The key was accessed, so it IS tracked (intent: even undefined reads create deps)
    expect(getAccessedKeys()).toContain("nonExistent");
  });

  it("write attempt throws TypeError and does not mutate original", () => {
    const ctx = { accountId: "original" };
    const { proxy } = createContextTrackingProxy(ctx);
    expect(() => {
      (proxy as any)["accountId"] = "mutated";
    }).toThrow(TypeError);
    expect(ctx.accountId).toBe("original");
  });
});
