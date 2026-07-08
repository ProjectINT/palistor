import { describe, it, expect } from "vitest";
import { getByPath } from "./getByPath";

describe("getByPath", () => {
  it("reads a nested dot-path", () => {
    expect(getByPath({ user: { address: { city: "NYC" } } }, "user.address.city")).toBe("NYC");
  });

  it("reads a top-level key", () => {
    expect(getByPath({ q: "a" }, "q")).toBe("a");
  });

  it("returns undefined for a missing segment", () => {
    expect(getByPath({ user: {} }, "user.address.city")).toBeUndefined();
  });

  it("returns undefined when walking through a primitive", () => {
    expect(getByPath({ a: 1 }, "a.b")).toBeUndefined();
  });

  it("returns undefined for null/undefined roots", () => {
    expect(getByPath(null, "a")).toBeUndefined();
    expect(getByPath(undefined, "a.b")).toBeUndefined();
  });
});
