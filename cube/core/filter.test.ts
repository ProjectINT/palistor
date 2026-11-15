/**
 * List filter behavior that differs from store on purpose (cube project only).
 * Shared behavior is in cube/contract/sliceE.
 */
import { describe, it, expect, vi } from "vitest";
import { Palistor } from "../palistor";
import { defineList } from "../defineList";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

type Vehicle = { id: string; name: string; brand_id: string };
const VEHICLES: Vehicle[] = [
  { id: "v1", name: "Alpha", brand_id: "b1" },
  { id: "v2", name: "Beta", brand_id: "b2" },
  { id: "v3", name: "Alpine", brand_id: "b1" },
];
const template = { id: { value: "" }, name: { value: "" }, brand_id: { value: "" } };

describe("server fields", () => {
  // store: every filter flush counts against MAX_AUTO_RETRIGGERS (10) and
  // nothing resets it, so a search box stops reaching the server after 10 searches.
  it("keep re-issuing past any restart cap: a search is a user action, not a dependency cycle", async () => {
    const resolver = vi.fn(async () => VEHICLES);
    const store = new Palistor({
      config: { vehicles: defineList({ template, filter: { q: "" }, resolve: { resolver } }) },
    });
    const list = store.proxy.vehicles;
    void list.items;
    await flush();
    for (let i = 1; i <= 25; i++) {
      list.filter.q.value = `x${i}`;
      await flush();
    }
    expect(resolver).toHaveBeenCalledTimes(26);
  });

  it("a change during a run re-issues once after it lands, with the latest values", async () => {
    const seen: unknown[] = [];
    let release!: () => void;
    const resolver = vi.fn(async (_v: unknown, _s: unknown, ctx: any) => {
      seen.push(ctx.filter.values.q);
      if (seen.length === 2) await new Promise<void>((r) => { release = r; });
      return VEHICLES;
    });
    const store = new Palistor({
      config: { vehicles: defineList({ template, filter: { q: "" }, resolve: { resolver } }) },
    });
    const list = store.proxy.vehicles;
    void list.items;
    await flush();

    list.filter.q.value = "a"; // run 2, held
    await flush();
    list.filter.q.value = "ab";
    list.filter.q.value = "abc";
    expect(resolver).toHaveBeenCalledTimes(2);
    release();
    await flush();
    await flush();
    expect(seen).toEqual(["", "a", "abc"]);
  });
});

describe("a filter is outside the form", () => {
  // store: the root proxy's live `values` carries a `$filters` key (getValues()
  // and resolver values strip it, `form.values` does not).
  it("store.proxy.values has no filter key", () => {
    const store = new Palistor({
      config: { name: { value: "" }, vehicles: defineList({ template, filter: { search: "" } }) },
    });
    expect(Object.keys(store.proxy.values)).toEqual(["name", "vehicles"]);
  });
});

describe("visible rows", () => {
  it("keep their array while a keystroke leaves the visible set as it was", async () => {
    const store = new Palistor({
      config: {
        vehicles: defineList({
          template,
          filter: { search: { value: "", where: (v: any, q: string) => v.name.toLowerCase().includes(q) } },
          resolve: { resolver: async () => VEHICLES },
        }),
      },
    });
    const list = store.proxy.vehicles;
    void list.items;
    await flush();

    list.filter.search.value = "al";
    const items = list.items;
    const version = store.getNodeVersion(list);
    list.filter.search.value = "alp"; // still Alpha, Alpine
    expect(list.items).toBe(items);
    expect(store.getNodeVersion(list)).toBe(version);
    list.filter.search.value = "alph";
    expect(list.items.map((v: any) => v.id)).toEqual(["v1"]);
    expect(store.getNodeVersion(list)).not.toBe(version);
  });

  it("an unrelated form write does not re-run the predicates", async () => {
    const where = vi.fn((v: any, q: string) => v.name.toLowerCase().includes(q));
    const store = new Palistor({
      config: {
        other: { value: "" },
        vehicles: defineList({ template, filter: { search: { value: "", where } }, resolve: { resolver: async () => VEHICLES } }),
      },
    });
    const list = store.proxy.vehicles;
    void list.items;
    await flush();
    list.filter.search.value = "al";
    void list.length;
    const calls = where.mock.calls.length;
    store.proxy.other.value = "x";
    void list.length;
    expect(where.mock.calls.length).toBe(calls);
  });
});
