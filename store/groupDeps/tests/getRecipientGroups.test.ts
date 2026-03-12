import { describe, it, expect } from "vitest";
import { getRecipientGroups } from "../getRecipientGroups";
import { pairKey } from "../pairKey";

describe("getRecipientGroups", () => {
  it("возвращает пустой массив при только self-зависимостях", () => {
    const deps = new Set([pairKey("", ""), pairKey("passport", "passport")]);
    expect(getRecipientGroups(deps, "")).toEqual([]);
    expect(getRecipientGroups(deps, "passport")).toEqual([]);
  });

  it("находит единственного реципиента", () => {
    const deps = new Set([pairKey("", ""), pairKey("", "passport")]);
    expect(getRecipientGroups(deps, "")).toEqual(["passport"]);
  });

  it("находит нескольких реципиентов для одного донора", () => {
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

  it("не путает донора и реципиента при обратной зависимости", () => {
    const deps = new Set([pairKey("passport", "")]);
    expect(getRecipientGroups(deps, "passport")).toEqual([""]);
    expect(getRecipientGroups(deps, "")).toEqual([]);
  });
});
