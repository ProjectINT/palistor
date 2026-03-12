import { describe, it, expect } from "vitest";
import { pairKey, parsePairKey } from "../pairKey";

describe("pairKey", () => {
  it("создаёт ключ donor→recipient", () => {
    expect(pairKey("root", "passport")).toBe("root\u2192passport");
  });

  it("поддерживает пустую строку как донора (root)", () => {
    expect(pairKey("", "passport")).toBe("\u2192passport");
  });

  it("self-зависимость: donor === recipient", () => {
    expect(pairKey("passport", "passport")).toBe("passport\u2192passport");
  });
});

describe("parsePairKey", () => {
  it("разбирает ключ обратно в [donor, recipient]", () => {
    expect(parsePairKey(pairKey("root", "passport"))).toEqual(["root", "passport"]);
  });

  it("корректно разбирает пустой донор", () => {
    expect(parsePairKey(pairKey("", "passport"))).toEqual(["", "passport"]);
  });

  it("pairKey и parsePairKey — взаимно обратные", () => {
    const [d, r] = parsePairKey(pairKey("a.b", "c.d"));
    expect(d).toBe("a.b");
    expect(r).toBe("c.d");
  });
});
