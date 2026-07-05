import { describe, it, expect } from "vitest";
import { getRecipientGroups } from "../getRecipientGroups";
import { pairKey } from "../pairKey";

describe("getRecipientGroups", () => {
  it("returns an empty array with only self-dependencies", () => {
    const deps = new Set([pairKey("", ""), pairKey("passport", "passport")]);
    expect(getRecipientGroups(deps, "")).toEqual([]);
    expect(getRecipientGroups(deps, "passport")).toEqual([]);
  });

  it("finds the single recipient", () => {
    const deps = new Set([pairKey("", ""), pairKey("", "passport")]);
    expect(getRecipientGroups(deps, "")).toEqual(["passport"]);
  });

  it("finds several recipients for one donor", () => {
    const deps = new Set([
      pairKey("", ""),
      pairKey("", "passport"),
      pairKey("", "address"),
    ]);
    const recipients = getRecipientGroups(deps, "");
    expect(recipients).toContain("passport");
    expect(recipients).toContain("address");
    expect(recipients.length).toBe(2);
  });

  it("does not confuse donor and recipient in a reverse dependency", () => {
    const deps = new Set([pairKey("passport", "")]);
    expect(getRecipientGroups(deps, "passport")).toEqual([""]);
    expect(getRecipientGroups(deps, "")).toEqual([]);
  });
});
