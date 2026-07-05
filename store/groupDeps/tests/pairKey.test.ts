import { describe, it, expect } from "vitest";
import { pairKey, parsePairKey } from "../pairKey";

describe("pairKey", () => {
  it("creates a donor→recipient key", () => {
    expect(pairKey("root", "passport")).toBe("root\u2192passport");
  });

  it("supports an empty string as the donor (root)", () => {
    expect(pairKey("", "passport")).toBe("\u2192passport");
  });

  it("self-dependency: donor === recipient", () => {
    expect(pairKey("passport", "passport")).toBe("passport\u2192passport");
  });
});

describe("parsePairKey", () => {
  it("parses the key back into [donor, recipient]", () => {
    expect(parsePairKey(pairKey("root", "passport"))).toEqual(["root", "passport"]);
  });

  it("correctly parses an empty donor", () => {
    expect(parsePairKey(pairKey("", "passport"))).toEqual(["", "passport"]);
  });

  it("pairKey and parsePairKey are inverses", () => {
    const [d, r] = parsePairKey(pairKey("a.b", "c.d"));
    expect(d).toBe("a.b");
    expect(r).toBe("c.d");
  });
});
