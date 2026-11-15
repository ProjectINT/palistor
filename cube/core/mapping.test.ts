/**
 * fieldMapping behavior that differs from store on purpose (cube project only).
 * Shared behavior is in cube/contract/sliceH.
 */
import { describe, it, expect } from "vitest";
import { Palistor } from "../palistor";
import { defineList } from "../defineList";

describe("normalization", () => {
  // store's normalizeConfig copies every object under a non-service key into a
  // plain object: with any active map, a Date default in a filter shorthand
  // became `{}` (filter.values: { since: {} }). Cube walks plain objects and
  // arrays only; anything else is a value and passes through as it is.
  it("a Date default in a filter shorthand stays a Date under an active map", () => {
    const since = new Date(0);
    const store = new Palistor({
      config: {
        users: defineList({ template: { id: { value: "" } }, filter: { since, q: "" } }),
      } as any,
      fieldMapping: { isRequired: "required" },
    });
    const filter = (store.proxy as any).users.filter;
    expect(filter.since.value).toBe(since);
    expect(filter.values).toEqual({ since, q: "" });
  });
});

describe("output", () => {
  // store: a componentProps key equal to an external name appeared twice in
  // the leaf proxy's ownKeys, and any spread threw "'ownKeys' on proxy: trap
  // returned duplicate entries". In Cube the field state keeps the name, as a
  // componentProps key equal to a state name does without a map.
  it("a componentProps key equal to an external name: the field state wins, spread works", () => {
    const store = new Palistor({
      config: { email: { value: "", helpText: "Field help", componentProps: { helpText: "prop", size: "lg" } } } as any,
      fieldMapping: { description: "helpText" },
    });
    const email = (store.proxy as any).email;
    const spread = { ...email };
    expect(spread.helpText).toBe("Field help");
    expect(spread.size).toBe("lg");
    expect(Object.keys(spread).filter((k) => k === "helpText")).toHaveLength(1);
  });
});
