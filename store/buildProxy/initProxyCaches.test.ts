import { describe, it, expect } from "vitest";
import { initProxyCaches } from "./initProxyCaches";

describe("initProxyCaches", () => {
  it("returns three separate WeakMap instances", () => {
    const caches = initProxyCaches();
    expect(caches.onValueChange).toBeInstanceOf(WeakMap);
    expect(caches.submit).toBeInstanceOf(WeakMap);
    expect(caches.reset).toBeInstanceOf(WeakMap);
  });

  it("returns fresh instances on each call", () => {
    const a = initProxyCaches();
    const b = initProxyCaches();
    expect(a.onValueChange).not.toBe(b.onValueChange);
    expect(a.submit).not.toBe(b.submit);
    expect(a.reset).not.toBe(b.reset);
  });
});
