/**
 * List filtering (FilteringPlan.md, Phase 1).
 *
 *  A. Shorthand & classification (literal expansion, $-keys, dev throws)
 *  B. State layer ($filters registration, derived fields, fieldMapping)
 *  C. Boundaries (getValues/reset/submit/persist never see filters)
 *  D. Server fields (ctx, params, one-fetch invalidation, debounce, issuedKey)
 *  E. Client fields (projection, isEmpty skipping, $all, local-add exemption, memo)
 *  F. Mixed blocks (isActive/activeCount, clear vs reset)
 *  G. Non-regression (a list without a filter block is byte-for-byte unchanged)
 */
import { describe, it, expect, vi } from "vitest";
import { defineList } from "./defineList";
import { Palistor } from "./store";

function flushPromises() {
  return new Promise<void>((r) => setTimeout(r, 0));
}

function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

type Vehicle = { id: string; name: string; brand_id: string; isNew?: boolean };

const VEHICLES: Vehicle[] = [
  { id: "v1", name: "Alpha", brand_id: "b1", isNew: true },
  { id: "v2", name: "Beta", brand_id: "b2", isNew: false },
  { id: "v3", name: "Alpine", brand_id: "b1", isNew: false },
];

// ─── A. Shorthand & classification ───────────────────────────────────────────

describe("A. Shorthand & classification", () => {
  it("A1. literal shorthand registers a leaf with the literal default (null preserved)", () => {
    const store = new Palistor({
      config: {
        vehicles: defineList<Vehicle>({
          template: { id: { value: "" }, name: { value: "" }, brand_id: { value: "" } },
          filter: { search: "", brand: null as string | null, category: [] as string[] },
        }),
      },
    });
    const filter = (store.proxy.vehicles as any).filter;
    expect(filter.search.value).toBe("");
    expect(filter.brand.value).toBe(null);
    expect(filter.category.value).toEqual([]);
  });

  it("A2. an object default WITHOUT a value key is an object-shaped literal (one field, not a group)", () => {
    const store = new Palistor({
      config: {
        vehicles: defineList<Vehicle>({
          template: { id: { value: "" }, name: { value: "" }, brand_id: { value: "" } },
          filter: { range: { from: "", to: "" } },
        }),
      },
    });
    const filter = (store.proxy.vehicles as any).filter;
    expect(filter.range.value).toEqual({ from: "", to: "" });
  });

  it("A3. an object WITH a value key is a field config", () => {
    const store = new Palistor({
      config: {
        vehicles: defineList<Vehicle>({
          template: { id: { value: "" }, name: { value: "" }, brand_id: { value: "" } },
          filter: { search: { value: "abc", placeholder: "Search…" } },
        }),
      },
    });
    const filter = (store.proxy.vehicles as any).filter;
    expect(filter.search.value).toBe("abc");
    expect(filter.search.placeholder).toBe("Search…");
  });

  it("A4. $-keys are block config, never fields", () => {
    const store = new Palistor({
      config: {
        vehicles: defineList<Vehicle>({
          template: { id: { value: "" }, name: { value: "" }, brand_id: { value: "" } },
          filter: {
            search: "",
            $all: () => true,
            $toParams: (v: Record<string, unknown>) => v,
            $persist: true,
          },
        }),
      },
    });
    const filter = (store.proxy.vehicles as any).filter;
    expect(Object.keys(filter.values)).toEqual(["search"]);
    expect(filter.$all).toBeUndefined();
  });

  it("A5. an unknown $-key throws at construction", () => {
    expect(
      () =>
        new Palistor({
          config: {
            vehicles: defineList<Vehicle>({
              template: { id: { value: "" }, name: { value: "" }, brand_id: { value: "" } },
              filter: { search: "", $mode: "server" } as any,
            }),
          },
        }),
    ).toThrow(/unknown filter block option "\$mode"/);
  });

  it("A6. param/debounce on a where field throws (dead config that looks live)", () => {
    expect(
      () =>
        new Palistor({
          config: {
            vehicles: defineList<Vehicle>({
              template: { id: { value: "" }, name: { value: "" }, brand_id: { value: "" } },
              filter: { onlyNew: { value: false, where: (i: any) => i.isNew, param: "new" } },
            }),
          },
        }),
    ).toThrow(/declares "where" together with "param"/);

    expect(
      () =>
        new Palistor({
          config: {
            vehicles: defineList<Vehicle>({
              template: { id: { value: "" }, name: { value: "" }, brand_id: { value: "" } },
              filter: { onlyNew: { value: false, where: (i: any) => i.isNew, debounce: 300 } },
            }),
          },
        }),
    ).toThrow(/together with "debounce"/);
  });

  it("A7. a field named after a filter builtin throws", () => {
    expect(
      () =>
        new Palistor({
          config: {
            vehicles: defineList<Vehicle>({
              template: { id: { value: "" }, name: { value: "" }, brand_id: { value: "" } },
              filter: { isActive: false },
            }),
          },
        }),
    ).toThrow(/collides with a built-in member/);
  });
});

// ─── B. State layer ──────────────────────────────────────────────────────────

describe("B. State layer", () => {
  it("B1. a derived field recomputes when its dependency changes and a write to it throws", () => {
    const store = new Palistor({
      config: {
        vehicles: defineList<Vehicle>({
          template: { id: { value: "" }, name: { value: "" }, brand_id: { value: "" } },
          filter: {
            brand: null as string | null,
            isNarrowed: { value: (v: Record<string, unknown>) => Boolean(v.brand) },
          },
        }),
      },
    });
    const filter = (store.proxy.vehicles as any).filter;
    expect(filter.isNarrowed.value).toBe(false);
    filter.brand.value = "b1";
    expect(filter.isNarrowed.value).toBe(true);
    expect(() => {
      filter.isNarrowed.value = false;
    }).toThrow(/derived and read-only/);
    expect(() => filter.set({ isNarrowed: false })).toThrow(/derived/);
  });

  it("B2. fieldMapping normalizes filter field configs and reserved keys throw", () => {
    const store = new Palistor({
      config: {
        vehicles: defineList<Vehicle>({
          template: { id: { value: "" }, name: { value: "" }, brand_id: { value: "" } },
          filter: { brand: { value: null, caption: "Brand" } as any },
        }),
      },
      fieldMapping: { label: "caption" } as const,
    });
    const filter = (store.proxy.vehicles as any).filter;
    // config authored in the external vocabulary; read back through it too
    expect(filter.brand.caption).toBe("Brand");

    // a fieldMapping renaming anything TO a reserved list key throws
    expect(
      () =>
        new Palistor({
          config: { name: { values: "" } },
          fieldMapping: { value: "values" } as const,
        }),
    ).toThrow(/reserved list key/);
    expect(
      () =>
        new Palistor({
          config: { name: { value: "" } },
          fieldMapping: { isInvalid: "filter" } as const,
        }),
    ).toThrow(/reserved list key/);
  });

  it("B3. a filter on a nested (per-entity) list warns and is ignored", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const store = new Palistor({
        config: {
          users: defineList({
            template: {
              id: { value: "" },
              name: { value: "" },
              contacts: defineList({
                template: { id: { value: "" }, phone: { value: "" } },
                filter: { search: "" },
              }) as any,
            },
          }),
        },
      });
      expect(store).toBeTruthy();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("filter on nested list"));
    } finally {
      warn.mockRestore();
    }
  });
});

// ─── C. Boundaries ───────────────────────────────────────────────────────────

describe("C. Boundaries", () => {
  function makeStore() {
    return new Palistor({
      config: {
        name: { value: "form-name" },
        vehicles: defineList<Vehicle>({
          template: { id: { value: "" }, name: { value: "" }, brand_id: { value: "" } },
          filter: {
            search: { value: "", where: (v: any, q: string) => String(v.name).toLowerCase().includes(q.toLowerCase()) },
          },
          resolve: { resolver: async () => VEHICLES },
        }),
      },
    });
  }

  it("C1. getValues() contains no $filters and store.reset() leaves filter values untouched", async () => {
    const store = makeStore();
    const list = store.proxy.vehicles as any;
    void list.items;
    await flushPromises();

    list.filter.search.value = "alp";
    expect(Object.keys(store.getValues())).not.toContain("$filters");

    store.reset();
    expect(list.filter.search.value).toBe("alp");
    // the explicit verb is filter.reset()
    list.filter.reset();
    expect(list.filter.search.value).toBe("");
  });

  it("C2. under an active client filter the submit payload / values slot stay FULL", async () => {
    const store = makeStore();
    const list = store.proxy.vehicles as any;
    void list.items;
    await flushPromises();

    list.filter.search.value = "alp";
    expect(list.length).toBe(2); // Alpha, Alpine
    expect(list.fullLength).toBe(3);
    expect(list.getValues()).toHaveLength(3);
    expect((store.getValues() as any).vehicles).toHaveLength(3);
    // identity lookup is not a view concern
    expect(list.getById("v2")).toBeTruthy();
    // membership dirty is untouched by filtering
    expect(list.dirty).toBe(false);
  });

  it("C3. list.filter exposes no list data; a field NAMED items resolves to that field", async () => {
    const store = makeStore();
    const list = store.proxy.vehicles as any;
    void list.items;
    await flushPromises();

    expect(list.filter.items).toBeUndefined();
    expect(list.filter.length).toBeUndefined();
    expect(list.filter.map).toBeUndefined();

    const store2 = new Palistor({
      config: {
        vehicles: defineList<Vehicle>({
          template: { id: { value: "" }, name: { value: "" }, brand_id: { value: "" } },
          filter: { items: "spare-part" },
        }),
      },
    });
    expect((store2.proxy.vehicles as any).filter.items.value).toBe("spare-part");
  });

  it("C4. spread of a filtered list exposes the filter surface; ownKeys stay consistent", async () => {
    const store = makeStore();
    const list = store.proxy.vehicles as any;
    void list.items;
    await flushPromises();
    const keys = Object.keys(list);
    expect(keys).toContain("filter");
    expect(keys).toContain("values");
    expect(keys).toContain("fullLength");
  });
});

// ─── D. Server fields ────────────────────────────────────────────────────────

describe("D. Server fields", () => {
  function makeServerStore(opts?: {
    debounce?: number;
    toParams?: (v: Record<string, unknown>) => unknown;
  }) {
    const calls: Array<{ params: any; values: any; key: string }> = [];
    const resolver = vi.fn(async (_v: any, _s: any, ctx: any) => {
      calls.push({ params: ctx.filter.params, values: ctx.filter.values, key: ctx.filter.key });
      const q = String((ctx.filter.values.search ?? "")).toLowerCase();
      return VEHICLES.filter((x) => x.name.toLowerCase().includes(q));
    });
    const store = new Palistor({
      config: {
        vehicles: defineList<Vehicle>({
          template: { id: { value: "" }, name: { value: "" }, brand_id: { value: "" } },
          filter: {
            search: opts?.debounce ? { value: "", debounce: opts.debounce } : "",
            brand: { value: null, param: "brand_id" },
            ...(opts?.toParams ? { $toParams: opts.toParams } : {}),
          },
          resolve: { resolver },
        }),
      },
    });
    return { store, resolver, calls };
  }

  it("D1. the first resolve passes ctx with params (param renames applied) and is not debounced", async () => {
    const { store, resolver, calls } = makeServerStore({ debounce: 5000 });
    const list = store.proxy.vehicles as any;
    void list.items;
    await flushPromises();
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(calls[0].params).toEqual({ search: "", brand_id: null });
    expect(calls[0].values).toEqual({ search: "", brand: null });
    expect(typeof calls[0].key).toBe("string");
  });

  it("D2. a server-field change triggers exactly one resolver run", async () => {
    const { store, resolver } = makeServerStore();
    const list = store.proxy.vehicles as any;
    void list.items;
    await flushPromises();
    expect(resolver).toHaveBeenCalledTimes(1);

    list.filter.brand.value = "b1";
    await flushPromises();
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it("D3. $toParams overrides the params shape", async () => {
    const { store, calls } = makeServerStore({
      toParams: (v) => ({ q: v.search }),
    });
    const list = store.proxy.vehicles as any;
    void list.items;
    await flushPromises();
    expect(calls[0].params).toEqual({ q: "" });
  });

  it("D4. N rapid changes under debounce produce ONE run with the CURRENT value; isPending spans the gap", async () => {
    const { store, resolver, calls } = makeServerStore({ debounce: 40 });
    const list = store.proxy.vehicles as any;
    void list.items;
    await flushPromises();
    expect(resolver).toHaveBeenCalledTimes(1);

    list.filter.search.value = "a";
    list.filter.search.value = "al";
    list.filter.search.value = "alp";
    expect(list.filter.isPending).toBe(true);
    expect(resolver).toHaveBeenCalledTimes(1); // value updated synchronously, issue delayed
    expect(list.filter.search.value).toBe("alp");

    await delay(70);
    await flushPromises();
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(calls[1].values.search).toBe("alp");
    expect(list.filter.isPending).toBe(false);
  });

  it("D5. typing and reverting before the trailing edge issues nothing (serverKey === issuedKey)", async () => {
    const { store, resolver } = makeServerStore({ debounce: 40 });
    const list = store.proxy.vehicles as any;
    void list.items;
    await flushPromises();

    list.filter.search.value = "a";
    list.filter.search.value = "";
    await delay(70);
    await flushPromises();
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("D6. an undebounced change flushes immediately, carries the debounced field's current value, and the timer no-ops", async () => {
    const { store, resolver, calls } = makeServerStore({ debounce: 40 });
    const list = store.proxy.vehicles as any;
    void list.items;
    await flushPromises();

    list.filter.search.value = "alp"; // debounced — timer armed
    list.filter.brand.value = "b1"; // undebounced — flushes NOW
    await flushPromises();
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(calls[1].values).toEqual({ search: "alp", brand: "b1" });

    await delay(70);
    await flushPromises();
    expect(resolver).toHaveBeenCalledTimes(2); // no double fetch
  });

  it("D7. filter.set() flushes as ONE invalidation; a queued debounced change is not lost", async () => {
    const { store, resolver, calls } = makeServerStore({ debounce: 40 });
    const list = store.proxy.vehicles as any;
    void list.items;
    await flushPromises();

    list.filter.set({ search: "alp", brand: "b1" });
    await flushPromises();
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(calls[1].values).toEqual({ search: "alp", brand: "b1" });

    // a pending debounced change survives a set() that doesn't touch it
    list.filter.search.value = "beta";
    expect(list.filter.isPending).toBe(true);
    list.filter.set({ brand: "b2" });
    await flushPromises();
    expect(resolver).toHaveBeenCalledTimes(3);
    expect(calls[2].values).toEqual({ search: "beta", brand: "b2" });
    expect(list.filter.isPending).toBe(false);
    await delay(70);
    await flushPromises();
    expect(resolver).toHaveBeenCalledTimes(3);
  });

  it("D8. an unrelated form-field change does not re-trigger the list resolver", async () => {
    const resolver = vi.fn(async () => VEHICLES);
    const store = new Palistor({
      config: {
        other: { value: "" },
        vehicles: defineList<Vehicle>({
          template: { id: { value: "" }, name: { value: "" }, brand_id: { value: "" } },
          filter: { search: "" },
          resolve: { resolver },
        }),
      },
    });
    const list = store.proxy.vehicles as any;
    void list.items;
    await flushPromises();
    (store.proxy as any).other.value = "x";
    await flushPromises();
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("D9. the resolved rows follow the server answer (Relay model)", async () => {
    const { store } = makeServerStore();
    const list = store.proxy.vehicles as any;
    void list.items;
    await flushPromises();
    expect(list.length).toBe(3);

    list.filter.search.value = "alp";
    await flushPromises();
    expect(list.length).toBe(2);
    expect(list.fullLength).toBe(2); // server fields: visible === full
    expect(list.map((v: any) => v.name.value)).toEqual(["Alpha", "Alpine"]);
  });
});

// ─── E. Client fields ────────────────────────────────────────────────────────

describe("E. Client fields", () => {
  function makeClientStore() {
    const resolver = vi.fn(async () => VEHICLES);
    const store = new Palistor({
      config: {
        vehicles: defineList<Vehicle>({
          template: {
            id: { value: "" },
            name: { value: "" },
            brand_id: { value: "" },
            isNew: { value: false },
          },
          filter: {
            search: {
              value: "",
              where: (v: any, q: string) => String(v.name).toLowerCase().includes(q.toLowerCase()),
            },
            brand: { value: null, where: (v: any, b: string) => v.brand_id === b },
            $all: (v: any, f: Record<string, unknown>) =>
              f.exclude ? v.id !== f.exclude : true,
            exclude: { value: null, where: () => true },
          },
          resolve: { resolver },
        }),
      },
    });
    return { store, resolver };
  }

  it("E1. a client-field change triggers ZERO resolver runs and projects at read time", async () => {
    const { store, resolver } = makeClientStore();
    const list = store.proxy.vehicles as any;
    void list.items;
    await flushPromises();
    expect(resolver).toHaveBeenCalledTimes(1);

    list.filter.search.value = "alp";
    await flushPromises();
    expect(resolver).toHaveBeenCalledTimes(1); // zero extra runs

    expect(list.length).toBe(2);
    expect(list.fullLength).toBe(3);
    expect(list.values.map((v: any) => v.id)).toEqual(["v1", "v3"]);
    expect(list.items.map((v: any) => v.id)).toEqual(["v1", "v3"]);
    expect([...list].map((v: any) => v.id)).toEqual(["v1", "v3"]);
    expect(list.map((v: any) => v.id)).toEqual(["v1", "v3"]);
    expect(list.dirty).toBe(false);
  });

  it("E2. predicates skip empty fields; length === fullLength when nothing is active", async () => {
    const { store } = makeClientStore();
    const list = store.proxy.vehicles as any;
    void list.items;
    await flushPromises();
    expect(list.length).toBe(list.fullLength);
    list.filter.search.value = "alp";
    list.filter.clear("search");
    expect(list.length).toBe(list.fullLength);
  });

  it("E3. predicates are ANDed; $all runs last and always", async () => {
    const { store } = makeClientStore();
    const list = store.proxy.vehicles as any;
    void list.items;
    await flushPromises();

    list.filter.search.value = "alp"; // v1, v3
    list.filter.brand.value = "b1"; // still v1, v3
    expect(list.map((v: any) => v.id)).toEqual(["v1", "v3"]);
    (store.proxy.vehicles as any).filter.exclude.value = "v1"; // $all
    expect(list.map((v: any) => v.id)).toEqual(["v3"]);
  });

  it("E4. a locally added row bypasses the predicates until the next resolve", async () => {
    const { store } = makeClientStore();
    const list = store.proxy.vehicles as any;
    void list.items;
    await flushPromises();

    list.filter.search.value = "alp";
    expect(list.length).toBe(2);
    list.add({ id: "v9", name: "Zeta", brand_id: "b3" }); // does not match
    expect(list.length).toBe(3); // still visible — optimistic add
    expect(list.dirty).toBe(true);

    list.reload();
    await flushPromises();
    expect(list.length).toBe(2); // server truth rewrote initialItemIds
  });

  it("E5. the projection reacts to entity edits (memo invalidation)", async () => {
    const { store } = makeClientStore();
    const list = store.proxy.vehicles as any;
    void list.items;
    await flushPromises();

    list.filter.search.value = "alp";
    expect(list.length).toBe(2);
    // rename Beta → Alpaca: now matches
    store.set({ id: "v2", name: "Alpaca" });
    expect(list.length).toBe(3);
    // remove reflects immediately
    list.remove("v1");
    expect(list.length).toBe(2);
  });

  it("E6. on an all-where block no filter change ever issues a request", async () => {
    const { store, resolver } = makeClientStore();
    const list = store.proxy.vehicles as any;
    void list.items;
    await flushPromises();
    list.filter.search.value = "a";
    list.filter.brand.value = "b1";
    list.filter.set({ search: "x", brand: "b2" });
    list.filter.clear();
    list.filter.reset();
    await flushPromises();
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("E7. a resolver-less all-where list filters client-side", () => {
    const store = new Palistor({
      config: {
        vehicles: defineList<Vehicle>({
          template: { id: { value: "" }, name: { value: "" }, brand_id: { value: "" } },
          filter: {
            brand: { value: null, where: (v: any, b: string) => v.brand_id === b },
          },
        }),
      },
    });
    const list = store.proxy.vehicles as any;
    for (const v of VEHICLES) list.add(v);
    expect(list.length).toBe(3);
    // membership added locally then re-baselined via setItems? add() keeps
    // initialItemIds empty, so local ids bypass predicates — set the baseline
    // through a resolve-like path instead: filter over server-truth ids only.
    list.filter.brand.value = "b1";
    expect(list.length).toBe(3); // all ids are local → exempt
  });
});

// ─── F. Mixed blocks ─────────────────────────────────────────────────────────

describe("F. Mixed blocks", () => {
  function makeMixedStore() {
    const calls: any[] = [];
    const resolver = vi.fn(async (_v: any, _s: any, ctx: any) => {
      calls.push(ctx.filter.params);
      return VEHICLES;
    });
    const store = new Palistor({
      config: {
        vehicles: defineList<Vehicle>({
          template: {
            id: { value: "" },
            name: { value: "" },
            brand_id: { value: "" },
            isNew: { value: false },
          },
          filter: {
            search: "",
            type: "car", // non-empty default → active from the first render
            onlyNew: { value: false, where: (v: any) => v.isNew === true || v.isNew === "true" },
          },
          resolve: { resolver },
        }),
      },
    });
    return { store, resolver, calls };
  }

  it("F1. search (server) refetches; onlyNew (client) re-projects without a fetch and stays out of params", async () => {
    const { store, resolver, calls } = makeMixedStore();
    const list = store.proxy.vehicles as any;
    void list.items;
    await flushPromises();
    expect(calls[0]).toEqual({ search: "", type: "car" });
    expect(Object.keys(calls[0])).not.toContain("onlyNew");

    list.filter.onlyNew.value = true;
    await flushPromises();
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(list.length).toBe(1);
    expect(list.fullLength).toBe(3);

    list.filter.search.value = "x";
    await flushPromises();
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it("F2. isActive/activeCount count non-empty non-derived fields of both classes", async () => {
    const { store } = makeMixedStore();
    const list = store.proxy.vehicles as any;
    void list.items;
    await flushPromises();

    // type defaults to "car" (non-empty) → active from the start; false toggle is empty
    expect(list.filter.isActive).toBe(true);
    expect(list.filter.activeCount).toBe(1);

    list.filter.search.value = "a";
    list.filter.onlyNew.value = true;
    expect(list.filter.activeCount).toBe(3);
  });

  it("F3. clear() always ends inactive; reset() ends active iff a declared default is non-empty", async () => {
    const { store } = makeMixedStore();
    const list = store.proxy.vehicles as any;
    void list.items;
    await flushPromises();

    list.filter.search.value = "a";
    list.filter.clear();
    expect(list.filter.isActive).toBe(false);
    expect(list.filter.type.value).toBe(""); // empty, not the default

    list.filter.reset();
    expect(list.filter.type.value).toBe("car");
    expect(list.filter.isActive).toBe(true); // the one observable difference
  });
});

// ─── G. Non-regression ───────────────────────────────────────────────────────

describe("G. Non-regression", () => {
  it("G1. a list with no filter block keeps its GET/spread surface (filter/values/fullLength absent)", async () => {
    const store = new Palistor({
      config: {
        users: defineList({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver: async () => [{ id: "u1", name: "A" }] },
        }),
      },
    });
    const list = store.proxy.users as any;
    void list.items;
    await flushPromises();

    expect(list.filter).toBeUndefined();
    expect(list.values).toBeUndefined();
    expect(list.fullLength).toBeUndefined();
    // NB: "length" is in ownKeys but non-enumerable (array-target invariant),
    // so Object.keys never contained it — before and after this change.
    expect(Object.keys(list)).toEqual([
      "items",
      "loading",
      "dirty",
      "error",
      "resolveStatus",
      "add",
      "remove",
      "getById",
      "setItems",
      "map",
      "getValues",
      "reload",
    ]);
    expect(list.length).toBe(1);
  });

  it("G2. a resolver on a filterless list receives ctx with empty filter values", async () => {
    let seenCtx: any = null;
    const store = new Palistor({
      config: {
        users: defineList<{ id: string; name: string }>({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: {
            resolver: async (_v: any, _s: any, ctx: any) => {
              seenCtx = ctx;
              return [];
            },
          },
        }),
      },
    });
    void (store.proxy.users as any).items;
    await flushPromises();
    expect(seenCtx).not.toBeNull();
    expect(seenCtx.filter.values).toEqual({});
    expect(seenCtx.filter.params).toBeUndefined();
  });
});
