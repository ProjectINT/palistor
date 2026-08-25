/**
 * List pagination (PaginationPlan.md, Phase 1 — paged mode, root lists).
 *
 *  A. Cache hits & navigation (no-resolver hot path, getters, tracking keys)
 *  B. queryKey invalidation (auto-deps, $context, unchanged value, re-key in place)
 *  C. Races (A→B mid-flight, A→B→A, concurrent pages, first-run drift, cycle cap)
 *  D. Mutations vs the cache (dirty across navigation, reset, delete, remove staling,
 *     reconcile, cross-page dedup, rekey + promotion)
 *  E. Persist round-trip (seed, fingerprint discard, foreign key not served)
 *  F. Compat (fieldMapping reservation, spread keys, non-paginated byte-for-byte,
 *     bare-array resolver, nested warning, snapshot proxy semantics)
 */
import { describe, it, expect, vi } from "vitest";
import { defineList } from "../defineList";
import { Palistor } from "../store";
import { LIST_SPREAD_KEYS, PAGINATION_SPREAD_KEYS } from "../constants";
import { createLiveValuesSnapshotProxy } from "../resolvePipeline/createLiveValuesSnapshotProxy";
import type { ListState } from "../store/types";
import type { PageRequest } from "./types";

function flushPromises() {
  return new Promise<void>((r) => setTimeout(r, 0));
}

type User = { id: string; name: string };

/** 45 users → 3 pages of 20 (last one has 5). */
const ALL: User[] = Array.from({ length: 45 }, (_, i) => ({ id: `u${i + 1}`, name: `User ${i + 1}` }));

interface Deferred {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  promise: Promise<unknown>;
}
function deferred(): Deferred {
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { resolve, reject, promise };
}

/**
 * A store with one paginated list. The resolver slices ALL by `ctx.page`,
 * optionally filtered by `values.search` (auto-dep) and `store.context.tenant`.
 * `gate` makes every call wait on a deferred so tests control completion.
 */
function makeStore(opts: {
  readSearch?: boolean;
  readTenant?: boolean;
  deps?: string[];
  gate?: boolean;
  pageSize?: number;
  bareArray?: boolean;
  context?: Record<string, unknown>;
  data?: User[];
} = {}) {
  const pageSize = opts.pageSize ?? 20;
  const calls: PageRequest[] = [];
  const pending: Deferred[] = [];
  const data = opts.data ?? ALL;
  const resolver = vi.fn(async (values: any, store: any, ctx: any) => {
    const req = ctx.page as PageRequest;
    calls.push({ ...req });
    let rows = data;
    if (opts.readSearch) {
      const s = String(values.search ?? "");
      if (s) rows = rows.filter((u) => u.name.includes(s));
    }
    if (opts.readTenant) {
      const t = store.context.tenant;
      if (t) rows = rows.filter((u) => u.id !== `u${t}`);
    }
    if (opts.gate) {
      const d = deferred();
      pending.push(d);
      await d.promise;
    }
    const items = rows.slice(req.offset, req.offset + req.pageSize);
    if (opts.bareArray) return items;
    return { items, total: rows.length };
  });
  const store = new Palistor({
    config: {
      search: { value: "" },
      other: { value: "" },
      users: defineList<User>({
        template: { id: { value: "" }, name: { value: "" } },
        resolve: {
          resolver: resolver as any,
          deps: opts.deps,
          pagination: { pageSize },
        },
      }),
    },
    context: opts.context,
  });
  const list = () => (store.proxy as any).users;
  const ls = (): ListState => store.nodes.listStates.get((store.rootConfig as any).users)!;
  const ids = () => list().items.map((i: any) => i.id);
  return { store, list, ls, ids, resolver, calls, pending };
}

async function load(s: ReturnType<typeof makeStore>) {
  void s.list().items; // lazy trigger
  await flushPromises();
}

// ─── A. Cache hits & navigation ──────────────────────────────────────────────

describe("A. Cache hits & navigation", () => {
  it("A1. a fresh cached page is a synchronous projection — zero resolver calls", async () => {
    const s = makeStore();
    await load(s);
    expect(s.resolver).toHaveBeenCalledTimes(1);
    expect(s.calls[0]).toMatchObject({ page: 1, pageSize: 20, offset: 0 });
    expect(s.ids()).toEqual(ALL.slice(0, 20).map((u) => u.id));

    s.list().setPage(2);
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(2);
    expect(s.calls[1]).toMatchObject({ page: 2, offset: 20 });
    expect(s.ids()).toEqual(ALL.slice(20, 40).map((u) => u.id));

    // Back to page 1: synchronous, no await, no resolver.
    const before = s.store.getNodeVersion(s.ls() as unknown as object);
    s.list().setPage(1);
    expect(s.list().page).toBe(1);
    expect(s.ids()).toEqual(ALL.slice(0, 20).map((u) => u.id));
    expect(s.store.getNodeVersion(s.ls() as unknown as object)).toBeGreaterThan(before);
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(2);
  });

  it("A2. getters: page/pageSize/pageCount/total/serverTotal/hasNextPage/hasPrevPage", async () => {
    const s = makeStore();
    await load(s);
    const l = s.list();
    expect(l.page).toBe(1);
    expect(l.pageSize).toBe(20);
    expect(l.total).toBe(45);
    expect(l.serverTotal).toBe(45);
    expect(l.pageCount).toBe(3);
    expect(l.hasPrevPage).toBe(false);
    expect(l.hasNextPage).toBe(true);
    l.nextPage();
    await flushPromises();
    l.nextPage();
    await flushPromises();
    expect(l.page).toBe(3);
    expect(l.hasNextPage).toBe(false);
    expect(l.hasPrevPage).toBe(true);
    expect(s.ids()).toEqual(["u41", "u42", "u43", "u44", "u45"]);
    l.nextPage(); // no-op past the last page
    await flushPromises();
    expect(l.page).toBe(3);
    expect(s.resolver).toHaveBeenCalledTimes(3);
    l.prevPage();
    l.prevPage();
    l.prevPage(); // no-op below base
    expect(l.page).toBe(1);
    expect(s.resolver).toHaveBeenCalledTimes(3);
  });

  it("A3. loading/isFetching/isInitialLoading derive from in-flight state", async () => {
    const s = makeStore({ gate: true });
    const l = s.list();
    expect(l.isFetching).toBe(false);
    expect(l.loading).toBe(false);
    void l.items;
    await flushPromises();
    expect(l.isFetching).toBe(true);
    expect(l.loading).toBe(true);
    expect(l.isInitialLoading).toBe(true);
    s.pending[0].resolve(undefined);
    await flushPromises();
    expect(l.isFetching).toBe(false);
    expect(l.isInitialLoading).toBe(false);
    expect(l.resolveStatus).toBe("resolved");
    l.setPage(2);
    expect(l.isFetching).toBe(true);
    expect(l.isInitialLoading).toBe(false);
    s.pending[1].resolve(undefined);
    await flushPromises();
    expect(l.isFetching).toBe(false);
  });

  it("A4. bootstrap: currentQueryKey is assigned at issue time and page 1 projects", async () => {
    const s = makeStore();
    void s.list().items;
    await flushPromises();
    expect(s.ls().pagination!.currentQueryKey).not.toBeNull();
    expect(s.ids().length).toBe(20);
  });

  it("A5. base 0 and initialPage", async () => {
    const calls: PageRequest[] = [];
    const store = new Palistor({
      config: {
        users: defineList<User>({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: {
            resolver: async (_v, _s, ctx) => {
              calls.push({ ...(ctx.page as PageRequest) });
              const r = ctx.page!;
              return { items: ALL.slice(r.offset, r.offset + r.pageSize), total: ALL.length };
            },
            pagination: { pageSize: 10, base: 0, initialPage: 2 },
          },
        }),
      },
    });
    void (store.proxy as any).users.items;
    await flushPromises();
    expect(calls[0]).toMatchObject({ page: 2, offset: 20, pageSize: 10 });
    expect((store.proxy as any).users.page).toBe(2);
    expect((store.proxy as any).users.pageCount).toBe(5);
    expect((store.proxy as any).users.hasPrevPage).toBe(true);
  });
});

// ─── B. queryKey invalidation ────────────────────────────────────────────────

describe("B. queryKey invalidation", () => {
  it("B1. an auto-dep change (no explicit deps) evicts the family and refetches page 1 once", async () => {
    const s = makeStore({ readSearch: true });
    await load(s);
    s.list().setPage(2);
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(2);
    // The refined dep set reached the SELECTION key.
    const state = s.store.resolveManager.states.get(s.ls().listConfigNode)!;
    expect(state.dependencies.has("search")).toBe(true);

    (s.store.proxy as any).search.value = "User 4";
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(3);
    expect(s.calls[2]).toMatchObject({ page: 1 });
    expect(s.list().page).toBe(1);
    // u4, u40..u45
    expect(s.ids()).toEqual(["u4", "u40", "u41", "u42", "u43", "u44", "u45"]);
    expect(s.list().total).toBe(7);
    expect(s.ls().pagination!.families.size).toBe(1);
  });

  it("B2. a $context change via setContext resets to page 1 and clears the counter", async () => {
    const s = makeStore({ readTenant: true, context: { tenant: 1 } });
    await load(s);
    expect(s.ids()[0]).toBe("u2");
    s.list().setPage(2);
    await flushPromises();
    const state = s.store.resolveManager.states.get(s.ls().listConfigNode)!;
    state.autoRetriggerCount = 5;
    s.store.setContext({ tenant: 2 });
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(3);
    expect(s.list().page).toBe(1);
    expect(s.ids()[0]).toBe("u1");
    expect(s.ids()).not.toContain("u2");
    expect(state.autoRetriggerCount).toBe(0);
  });

  it("B3. an unchanged-value notify is a strict no-op (cached page still served)", async () => {
    const s = makeStore({ readSearch: true });
    await load(s);
    (s.store.proxy as any).search.value = "";
    (s.store.proxy as any).other.value = "x";
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(1);
    expect(s.ids().length).toBe(20);
  });

  it("B4. first-run dep widening renames the family in place — no spurious second fetch", async () => {
    const s = makeStore({ readSearch: true });
    await load(s);
    const p = s.ls().pagination!;
    expect(p.families.size).toBe(1);
    const fam = p.families.get(p.currentQueryKey!)!;
    expect(fam.settled).toBe(true);
    expect(fam.dependencies.has("search")).toBe(true);
    // Touch the list again and a sibling path — nothing refetches.
    void s.list().items;
    (s.store.proxy as any).other.value = "y";
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(1);
  });

  it("B5. explicit deps seed the bootstrap key — a change before the first fetch is simply read fresh", async () => {
    const s = makeStore({ readSearch: true, deps: ["search"] });
    (s.store.proxy as any).search.value = "User 1";
    await load(s);
    expect(s.resolver).toHaveBeenCalledTimes(1);
    expect(s.ids()).toEqual(["u1", "u10", "u11", "u12", "u13", "u14", "u15", "u16", "u17", "u18", "u19"]);
  });

  it("B6. flipping back to a still-cached query is served without a fetch (maxCachedQueries: 2)", async () => {
    const calls: string[] = [];
    const store = new Palistor({
      config: {
        search: { value: "" },
        users: defineList<User>({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: {
            resolver: async (values: any, _s, ctx) => {
              calls.push(values.search);
              const r = ctx.page!;
              const rows = values.search ? ALL.filter((u) => u.name.includes(values.search)) : ALL;
              return { items: rows.slice(r.offset, r.offset + r.pageSize), total: rows.length };
            },
            pagination: { pageSize: 20, maxCachedQueries: 2 },
          },
        }),
      },
    });
    void (store.proxy as any).users.items;
    await flushPromises();
    (store.proxy as any).search.value = "User 4";
    await flushPromises();
    expect(calls).toEqual(["", "User 4"]);
    (store.proxy as any).search.value = "";
    await flushPromises();
    expect(calls).toEqual(["", "User 4"]);
    expect((store.proxy as any).users.items.length).toBe(20);
  });

  it("B7. a declared server filter change is one page-1 fetch through the filter gate", async () => {
    const calls: unknown[] = [];
    const store = new Palistor({
      config: {
        users: defineList<User>({
          template: { id: { value: "" }, name: { value: "" } },
          filter: { q: "" },
          resolve: {
            resolver: async (_v, _s, ctx) => {
              calls.push(ctx.filter.params);
              const r = ctx.page!;
              const q = (ctx.filter.values as { q: string }).q;
              const rows = q ? ALL.filter((u) => u.name.includes(q)) : ALL;
              return { items: rows.slice(r.offset, r.offset + r.pageSize), total: rows.length };
            },
            pagination: { pageSize: 20 },
          },
        }),
      },
    });
    const list = (store.proxy as any).users;
    void list.items;
    await flushPromises();
    list.setPage(2);
    await flushPromises();
    expect(list.page).toBe(2);
    list.filter.q.value = "User 3";
    await flushPromises();
    expect(calls.length).toBe(3);
    expect(calls[2]).toEqual({ q: "User 3" });
    expect(list.page).toBe(1);
    expect(list.total).toBe(11);
  });
});

// ─── C. Races ────────────────────────────────────────────────────────────────

describe("C. Races", () => {
  it("C1. A→B mid-flight: the stale completion writes nothing, releases inFlight, B fetched once", async () => {
    const s = makeStore({ readSearch: true, deps: ["search"], gate: true });
    void s.list().items;
    await flushPromises();
    expect(s.pending.length).toBe(1);
    const famA = s.ls().pagination!.families.get(s.ls().pagination!.currentQueryKey!)!;
    (s.store.proxy as any).search.value = "User 4";
    await flushPromises();
    // A pending entry is never selected by the hook (nor marked, the paged
    // executor consumes no pendingRetrigger) — the drift check reroutes it.
    expect(s.pending.length).toBe(1);
    s.pending[0].resolve(undefined); // A completes under drifted values
    await flushPromises();
    expect(s.pending.length).toBe(2); // B issued once
    expect(famA.inFlight.size).toBe(0); // A released, no leak
    expect(s.ids()).toEqual([]); // nothing projected from A
    expect(s.ls().pagination!.families.size).toBe(1);
    s.pending[1].resolve(undefined);
    await flushPromises();
    expect(s.ids()).toEqual(["u4", "u40", "u41", "u42", "u43", "u44", "u45"]);
    expect(s.resolver).toHaveBeenCalledTimes(2);
    expect(s.list().isFetching).toBe(false);
    expect(s.list().resolveStatus).toBe("resolved");
  });

  it("C2. A→B→A mid-flight is no drift (values reverted) — the single run lands", async () => {
    const s = makeStore({ readSearch: true, deps: ["search"], gate: true });
    void s.list().items;
    await flushPromises();
    (s.store.proxy as any).search.value = "User 4";
    (s.store.proxy as any).search.value = "";
    await flushPromises();
    s.pending[0].resolve(undefined);
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(1);
    expect(s.ids().length).toBe(20);
    expect(s.list().isFetching).toBe(false);
  });

  it("C2b. a sibling in-flight fetch is superseded by the generation bump of a drift re-key", async () => {
    const s = makeStore({ readSearch: true, deps: ["search"], gate: true });
    void s.list().items;
    await flushPromises();
    s.pending[0].resolve(undefined);
    await flushPromises();
    s.list().setPage(2);
    s.list().setPage(3);
    await flushPromises();
    expect(s.pending.length).toBe(3);
    const famA = s.ls().pagination!.families.get(s.ls().pagination!.currentQueryKey!)!;
    (s.store.proxy as any).search.value = "User 4";
    s.pending[2].resolve(undefined); // page 3 completes → drift → evict A, fetch B page 1
    await flushPromises();
    expect(s.pending.length).toBe(4);
    expect(s.list().page).toBe(1);
    s.pending[1].resolve(undefined); // page 2 of A: older generation → pure no-op
    await flushPromises();
    expect(famA.pages.has(2)).toBe(false);
    expect(s.ids()).toEqual([]);
    expect(s.list().isFetching).toBe(true);
    s.pending[3].resolve(undefined);
    await flushPromises();
    expect(s.ids()).toEqual(["u4", "u40", "u41", "u42", "u43", "u44", "u45"]);
    expect(s.list().isFetching).toBe(false);
    expect(s.ls().pagination!.families.size).toBe(1);
  });

  it("C3. concurrent page fetches: isFetching stays true until inFlight drains; out-of-order completion", async () => {
    const s = makeStore({ gate: true });
    void s.list().items;
    await flushPromises();
    s.pending[0].resolve(undefined);
    await flushPromises();
    s.list().setPage(2);
    s.list().setPage(3);
    await flushPromises();
    expect(s.pending.length).toBe(3);
    expect(s.list().isFetching).toBe(true);
    s.pending[2].resolve(undefined); // page 3 first
    await flushPromises();
    expect(s.list().page).toBe(3);
    expect(s.ids()).toEqual(["u41", "u42", "u43", "u44", "u45"]);
    expect(s.list().isFetching).toBe(true);
    expect(s.list().resolveStatus).toBe("pending");
    s.pending[1].resolve(undefined); // page 2 lands in cache only
    await flushPromises();
    expect(s.list().isFetching).toBe(false);
    expect(s.list().resolveStatus).toBe("resolved");
    expect(s.list().page).toBe(3);
    s.list().setPage(2);
    expect(s.ids()[0]).toBe("u21");
    expect(s.resolver).toHaveBeenCalledTimes(3);
  });

  it("C4. first-run drift: an auto-dep edited mid-flight after being read reroutes, no thrash", async () => {
    const s = makeStore({ readSearch: true, gate: true });
    void s.list().items;
    await flushPromises();
    (s.store.proxy as any).search.value = "User 4";
    await flushPromises();
    // Not selected by the hook (deps unknown, status pending) — only the drift check can see it.
    expect(s.pending.length).toBe(1);
    s.pending[0].resolve(undefined);
    await flushPromises();
    expect(s.pending.length).toBe(2);
    s.pending[1].resolve(undefined);
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(2);
    expect(s.ids()).toEqual(["u4", "u40", "u41", "u42", "u43", "u44", "u45"]);
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(2);
  });

  it("C5. bootstrap race: a dep edited BEFORE the resolver's first read files under the fresh key", async () => {
    let releaseRead!: () => void;
    const gateRead = new Promise<void>((r) => (releaseRead = r));
    const calls: string[] = [];
    const store = new Palistor({
      config: {
        search: { value: "" },
        users: defineList<User>({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: {
            resolver: async (values: any, _s, ctx) => {
              await gateRead; // the edit lands before the first read
              const q = values.search as string;
              calls.push(q);
              const r = ctx.page!;
              const rows = q ? ALL.filter((u) => u.name.includes(q)) : ALL;
              return { items: rows.slice(r.offset, r.offset + r.pageSize), total: rows.length };
            },
            pagination: { pageSize: 20 },
          },
        }),
      },
    });
    const list = (store.proxy as any).users;
    void list.items;
    await flushPromises();
    (store.proxy as any).search.value = "User 4";
    releaseRead();
    await flushPromises();
    await flushPromises();
    expect(calls).toEqual(["User 4"]);
    expect(list.items.map((i: any) => i.id)).toEqual(["u4", "u40", "u41", "u42", "u43", "u44", "u45"]);
    const ls = store.nodes.listStates.get((store.rootConfig as any).users)!;
    const p = ls.pagination!;
    expect(p.families.size).toBe(1);
    expect(p.currentQueryKey).toContain("User 4");
    // The refined family key matches the live values: a later notify is a no-op.
    (store.proxy as any).search.value = "User 4";
    await flushPromises();
    expect(calls.length).toBe(1);
  });

  it("C6. cycle guard: a self-retriggering paginated resolver caps at MAX_AUTO_RETRIGGERS", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let n = 0;
    const store = new Palistor({
      config: {
        counter: { value: 0 },
        users: defineList<User>({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: {
            resolver: async (values: any, store: any) => {
              void values.counter;
              n++;
              // Write the dep it reads → A→A each completion.
              queueMicrotask(() => {
                store.proxy.counter.value = n;
              });
              return { items: ALL.slice(0, 5), total: 5 };
            },
            pagination: { pageSize: 5 },
          },
        }),
      },
    });
    void (store.proxy as any).users.items;
    for (let i = 0; i < 40; i++) await flushPromises();
    expect(n).toBeLessThanOrEqual(12);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("auto-retrigger cap"));
    warn.mockRestore();
  });

  it("C7. refetch() is exactly one forced request; a concurrent in-flight fetch of the same ordinal loses", async () => {
    const s = makeStore({ gate: true });
    void s.list().items;
    await flushPromises();
    s.pending[0].resolve(undefined);
    await flushPromises();
    s.list().setPage(2);
    await flushPromises();
    const p = s.list().refetch();
    await flushPromises();
    expect(s.pending.length).toBe(3);
    const fam = s.ls().pagination!.families.get(s.ls().pagination!.currentQueryKey!)!;
    expect(fam.pages.get(1)!.status).toBe("stale");
    s.pending[1].resolve(undefined); // superseded page-2 fetch
    await flushPromises();
    expect(s.list().isFetching).toBe(true);
    expect(fam.inFlight.size).toBe(1);
    s.pending[2].resolve(undefined);
    await p;
    await flushPromises();
    expect(s.list().isFetching).toBe(false);
    expect(s.ids()[0]).toBe("u21");
    expect(s.resolver).toHaveBeenCalledTimes(3);
    // Stale sibling refetches on visit.
    s.list().setPage(1);
    await flushPromises();
    expect(s.pending.length).toBe(4);
  });

  it("C8. a resolver error lands on the resolve state and releases inFlight", async () => {
    const onError = vi.fn();
    const store = new Palistor({
      config: {
        users: defineList<User>({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: {
            resolver: async () => {
              throw new Error("boom");
            },
            onError,
            pagination: { pageSize: 20 },
          },
        }),
      },
    });
    const list = (store.proxy as any).users;
    void list.items;
    await flushPromises();
    expect(list.resolveStatus).toBe("error");
    expect((list.error as Error).message).toBe("boom");
    expect(list.isFetching).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

// ─── D. Mutations vs the cache ───────────────────────────────────────────────

describe("D. Mutations vs the cache", () => {
  it("D1. dirty survives navigation (baseline from initialIds, never re-based from ids)", async () => {
    const s = makeStore();
    await load(s);
    s.list().add({ id: "new1", name: "New" });
    expect(s.list().dirty).toBe(true);
    expect(s.list().total).toBe(46);
    expect(s.list().serverTotal).toBe(45);
    expect(s.list().hasNextPage).toBe(true);
    s.list().nextPage();
    await flushPromises();
    // Phase 3: dirty is the AGGREGATE per-page rollup — the un-flushed add
    // parked on page 1 keeps the list dirty while page 2 is on screen.
    expect(s.list().dirty).toBe(true);
    expect(s.list().pendingAdds).toEqual(["new1"]);
    s.list().prevPage();
    expect(s.list().dirty).toBe(true);
    expect(s.ids()).toContain("new1");
  });

  it("D2. reset rolls back edits, not navigation — zero resolver calls, status stays resolved", async () => {
    const s = makeStore();
    await load(s);
    s.list().setPage(3);
    await flushPromises();
    s.list().add({ id: "new1", name: "New" });
    s.list().remove("u41");
    expect(s.list().dirty).toBe(true);
    s.store.reset();
    expect(s.list().page).toBe(3);
    expect(s.list().dirty).toBe(false);
    expect(s.ids()).toEqual(["u41", "u42", "u43", "u44", "u45"]);
    expect(s.list().resolveStatus).toBe("resolved");
    void s.list().items;
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(2);
    expect(s.store.getValues().users.length).toBe(5);
  });

  it("D3. delete reaches an off-screen cached page — length === items.length === getValues().length", async () => {
    const s = makeStore();
    await load(s);
    s.list().setPage(3);
    await flushPromises();
    s.list().setPage(1);
    s.store.delete("u43");
    expect(s.list().total).toBe(44);
    expect(s.list().serverTotal).toBe(44);
    s.list().setPage(3);
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(2); // page 3 still cached (nothing after it to stale)
    expect(s.list().length).toBe(4);
    expect(s.list().items.length).toBe(4);
    expect(s.store.getValues().users.length).toBe(4);
    expect(s.list().dirty).toBe(false);
  });

  it("D4. remove() of a server row stales the later pages (splice ordinal, not currentPage)", async () => {
    const s = makeStore();
    await load(s);
    s.list().setPage(2);
    await flushPromises();
    s.list().setPage(3);
    await flushPromises();
    s.list().setPage(1);
    s.list().remove("u2");
    expect(s.list().total).toBe(44);
    expect(s.list().serverTotal).toBe(45);
    const fam = s.ls().pagination!.families.get(s.ls().pagination!.currentQueryKey!)!;
    expect(fam.pages.get(2)!.status).toBe("stale");
    expect(fam.pages.get(3)!.status).toBe("stale");
    s.list().setPage(2);
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(4);
    // A remove of a LOCAL add stales nothing.
    s.list().setPage(3);
    await flushPromises();
    s.list().add({ id: "tmp", name: "T" });
    s.list().remove("tmp");
    expect(fam.pages.get(3)!.status).toBe("fresh");
  });

  it("D5. a refetch reconciles an un-flushed optimistic add instead of clobbering it", async () => {
    const s = makeStore();
    await load(s);
    s.list().add({ id: "new1", name: "New" });
    s.list().invalidate(1);
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(2);
    const ids = s.ids();
    expect(ids.length).toBe(21);
    expect(ids[ids.length - 1]).toBe("new1");
    expect(s.list().dirty).toBe(true);
  });

  it("D6. cross-page dedup: add() of an id parked on another page is rejected; a fetched dup is dropped", async () => {
    const s = makeStore();
    await load(s);
    s.list().setPage(3);
    await flushPromises();
    s.list().setPage(1);
    s.list().add("u43");
    expect(s.ids()).not.toContain("u43");
    expect(s.list().dirty).toBe(false);
    // A server page that returns an already-present id (u1 moved to page 3).
    const s2 = makeStore({ data: [...ALL.slice(0, 40), ALL[0], ...ALL.slice(40)] });
    await load(s2);
    s2.list().setPage(3);
    await flushPromises();
    expect(s2.ids()).toEqual(["u41", "u42", "u43", "u44", "u45"]);
  });

  it("D7. rekey reaches off-screen pages and PROMOTES a confirmed add (guard unblocked, serverTotal +1)", async () => {
    const s = makeStore();
    await load(s);
    s.list().add({ name: "Draft" }); // tmp id
    const tmpId = s.ids()[20];
    expect(tmpId.startsWith("_tmp_")).toBe(true);
    s.list().nextPage();
    await flushPromises();
    s.store.rekey(tmpId, "real1");
    s.list().prevPage();
    expect(s.ids()).toContain("real1");
    expect(s.ids()).not.toContain(tmpId);
    expect(s.list().dirty).toBe(false);
    expect(s.list().serverTotal).toBe(46);
    expect(s.list().total).toBe(46);
    // Idempotent.
    s.store.rekey("real1", "real1");
    expect(s.list().serverTotal).toBe(46);
  });

  it("D8. setItems replaces the current page; a cardinality change stales the later pages", async () => {
    const s = makeStore();
    await load(s);
    s.list().setPage(2);
    await flushPromises();
    s.list().setPage(1);
    const fam = s.ls().pagination!.families.get(s.ls().pagination!.currentQueryKey!)!;
    s.list().setItems(["u2", "u1", ...ALL.slice(2, 20).map((u) => u.id)]);
    expect(s.ids().slice(0, 2)).toEqual(["u2", "u1"]);
    expect(fam.pages.get(2)!.status).toBe("fresh");
    s.list().setItems(["u1"]);
    expect(fam.pages.get(2)!.status).toBe("stale");
    expect(s.list().dirty).toBe(true);
  });

  it("D9. an empty page result is a `{ ids: [] }` entry — never the legacy wipe", async () => {
    const s = makeStore();
    await load(s);
    s.list().setPage(9);
    await flushPromises();
    expect(s.ids()).toEqual([]);
    expect(s.list().hasNextPage).toBe(false);
    s.list().setPage(1);
    expect(s.ids().length).toBe(20);
    expect(s.resolver).toHaveBeenCalledTimes(2);
  });

  it("D10. add() before the first fetch is reconciled by the bootstrap fetch", async () => {
    const s = makeStore();
    s.list().add({ id: "draft", name: "D" });
    expect(s.ids()).toEqual(["draft"]);
    await flushPromises();
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(1);
    expect(s.ids().length).toBe(21);
    expect(s.ids()).toContain("draft");
    expect(s.list().dirty).toBe(true);
  });
});

// ─── E. Persist round-trip ───────────────────────────────────────────────────

function memoryDriver() {
  const mem = new Map<string, string>();
  return {
    mem,
    driver: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    },
  };
}

describe("E. Persist round-trip", () => {
  it("E1. serialize on page 2, hydrate → cache hit: ordinal 2, total restored, zero refetch", async () => {
    const { driver, mem } = memoryDriver();
    const s = makeStore({ readSearch: true });
    await s.store.persist.enable({ key: "k", driver, debounce: 0 });
    await load(s);
    s.list().setPage(2);
    await flushPromises();
    await s.store.persist.flush();
    const raw = JSON.parse(mem.get("k")!);
    expect(raw.__pagination.users.currentPage).toBe(2);
    expect(raw.__pagination.users.deps).toContain("search");

    const s2 = makeStore({ readSearch: true });
    await s2.store.persist.enable({ key: "k", driver, debounce: 0 });
    await flushPromises();
    expect(s2.list().page).toBe(2);
    expect(s2.list().total).toBe(45);
    expect(s2.list().resolveStatus).toBe("resolved");
    expect(s2.ids()).toEqual(ALL.slice(20, 40).map((u) => u.id));
    void s2.list().items;
    await flushPromises();
    expect(s2.resolver).toHaveBeenCalledTimes(0);
    // Hydration did not evict itself; a real change still invalidates.
    (s2.store.proxy as any).search.value = "User 4";
    await flushPromises();
    expect(s2.resolver).toHaveBeenCalledTimes(1);
    expect(s2.list().page).toBe(1);
  });

  it("E2. a pageSize change between save and hydrate discards the blob → one reconciling fetch", async () => {
    const { driver } = memoryDriver();
    const s = makeStore();
    await s.store.persist.enable({ key: "k", driver, debounce: 0 });
    await load(s);
    s.list().setPage(2);
    await flushPromises();
    await s.store.persist.flush();

    const s2 = makeStore({ pageSize: 10 });
    await s2.store.persist.enable({ key: "k", driver, debounce: 0 });
    await flushPromises();
    expect(s2.list().page).toBe(1);
    expect(s2.list().resolveStatus).toBe("idle");
    expect(s2.ids().length).toBe(20); // restored draft served meanwhile
    void s2.list().items;
    await flushPromises();
    expect(s2.resolver).toHaveBeenCalledTimes(1);
    expect(s2.ids().length).toBe(10);
  });

  it("E3. a window saved under another context is NOT served; one fetch runs under the live key", async () => {
    const { driver } = memoryDriver();
    const s = makeStore({ readTenant: true, context: { tenant: 1 } });
    await s.store.persist.enable({ key: "k", driver, debounce: 0 });
    await load(s);
    await s.store.persist.flush();

    const s2 = makeStore({ readTenant: true, context: { tenant: 2 } });
    await s2.store.persist.enable({ key: "k", driver, debounce: 0 });
    await flushPromises();
    expect(s2.list().resolveStatus).toBe("idle");
    expect(s2.ids()).toEqual([]);
    void s2.list().items;
    await flushPromises();
    expect(s2.resolver).toHaveBeenCalledTimes(1);
    expect(s2.ids()).not.toContain("u2");
    expect(s2.ids()).toContain("u1");
  });

  it("E4. a locally removed server row survives the round-trip and reset() resurrects it with a body", async () => {
    const { driver } = memoryDriver();
    const s = makeStore();
    await s.store.persist.enable({ key: "k", driver, debounce: 0 });
    await load(s);
    s.list().remove("u3");
    await s.store.persist.flush();

    const s2 = makeStore();
    await s2.store.persist.enable({ key: "k", driver, debounce: 0 });
    await flushPromises();
    expect(s2.list().dirty).toBe(true);
    expect(s2.list().length).toBe(19);
    s2.store.reset();
    expect(s2.list().length).toBe(20);
    expect(s2.list().items.length).toBe(20);
    expect(s2.store.getValues().users.length).toBe(20);
  });

  it("E5. omit of the list drops the blob too (no bodiless window)", async () => {
    const { driver, mem } = memoryDriver();
    const s = makeStore();
    await s.store.persist.enable({ key: "k", driver, debounce: 0, omit: ["users"] as any });
    await load(s);
    await s.store.persist.flush();
    const raw = JSON.parse(mem.get("k")!);
    expect(raw.__pagination).toBeUndefined();
    expect(raw.users).toBeUndefined();
  });
});

// ─── F. Compat ───────────────────────────────────────────────────────────────

describe("F. Compat", () => {
  it("F1. fieldMapping onto a pagination key throws at construction", () => {
    expect(
      () =>
        new Palistor({
          config: { name: { value: "" } },
          fieldMapping: { dirty: "page" } as any,
        }),
    ).toThrow(/reserved list key/);
    expect(
      () =>
        new Palistor({
          config: { name: { value: "" } },
          fieldMapping: { loading: "isFetching" } as any,
        }),
    ).toThrow(/reserved list key/);
  });

  it("F2. spread/ownKeys: pagination keys present on a paginated list, byte-for-byte unchanged otherwise", async () => {
    // `length` mirrors the array target's non-enumerable descriptor — Object.keys skips it.
    const enumerable = (keys: string[]) => keys.filter((k) => k !== "length");
    const s = makeStore();
    expect(Object.keys(s.list())).toEqual(enumerable([...LIST_SPREAD_KEYS, ...PAGINATION_SPREAD_KEYS]));
    expect(Reflect.ownKeys(s.list())).toEqual([...LIST_SPREAD_KEYS, ...PAGINATION_SPREAD_KEYS]);
    const plain = new Palistor({
      config: {
        users: defineList<User>({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver: async () => ALL.slice(0, 3) },
        }),
      },
    });
    const pl = (plain.proxy as any).users;
    expect(Object.keys(pl)).toEqual(enumerable(LIST_SPREAD_KEYS));
    expect(Reflect.ownKeys(pl)).toEqual(LIST_SPREAD_KEYS);
    expect(pl.page).toBeUndefined();
    expect(pl.setPage).toBeUndefined();
    const ls = plain.nodes.listStates.get((plain.rootConfig as any).users)!;
    expect(ls.pagination).toBeUndefined();
    void pl.items;
    await flushPromises();
    expect(pl.items.length).toBe(3);
    expect(pl.loading).toBe(false);
  });

  it("F3. a paginated resolver returning a bare array paginates via the loaded-page heuristic", async () => {
    const s = makeStore({ bareArray: true });
    await load(s);
    expect(s.list().total).toBeUndefined();
    expect(s.list().serverTotal).toBeUndefined();
    expect(s.list().pageCount).toBe(1);
    expect(s.list().hasNextPage).toBe(true); // full page
    s.list().nextPage();
    await flushPromises();
    s.list().nextPage();
    await flushPromises();
    expect(s.list().page).toBe(3);
    expect(s.list().hasNextPage).toBe(false); // 5 < pageSize
    expect(s.list().pageCount).toBe(3);
  });

  it("F4. resolve.pagination on a nested list paginates EACH per-entity instance (Phase 3) — no warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = new Palistor({
      config: {
        owners: defineList<{ id: string; name: string }>({
          template: {
            id: { value: "" },
            name: { value: "" },
            pets: [
              { id: { value: "" }, kind: { value: "" } },
              {
                resolve: {
                  resolver: async (owner: any, _s: any, ctx: any) => ({
                    items: [{ id: `${owner.id}-p${ctx.page.page}`, kind: "cat" }],
                    total: 3,
                  }),
                  pagination: { pageSize: 1 },
                },
              },
            ],
          } as any,
          resolve: { resolver: async () => [{ id: "o1", name: "A" }, { id: "o2", name: "B" }] },
        }),
      },
    });
    const owners = (store.proxy as any).owners;
    void owners.items;
    await flushPromises();
    const [o1, o2] = owners.items;
    void o1.pets.items;
    void o2.pets.items;
    await flushPromises();
    expect(o1.pets.items.map((p: any) => p.id)).toEqual(["o1-p1"]);
    expect(o2.pets.items.map((p: any) => p.id)).toEqual(["o2-p1"]);
    expect(typeof o1.pets.setPage).toBe("function");
    expect(o1.pets.pageCount).toBe(3);
    o1.pets.nextPage();
    await flushPromises();
    expect(o1.pets.items.map((p: any) => p.id)).toEqual(["o1-p2"]);
    expect(o2.pets.page).toBe(1); // instances are independent
    const nestedWarns = warn.mock.calls.filter((c) => String(c[0]).includes("nested (per-entity) list"));
    expect(nestedWarns.length).toBe(0);
    warn.mockRestore();
  });

  it("F5. bad config throws at construction; every page mode is accepted", () => {
    const mk = (pagination: any) =>
      new Palistor({
        config: {
          users: defineList<User>({
            template: { id: { value: "" }, name: { value: "" } },
            resolve: { resolver: async () => [], pagination },
          }),
        },
      });
    expect(() => mk({ pageSize: 0 })).toThrow(/pageSize/);
    expect(() => mk({ pageSize: 10, base: 2 })).toThrow(/base/);
    expect(() => mk({ pageSize: 10, mode: "sideways" })).toThrow(/page mode/);
    expect(() => mk({ pageSize: 10, persist: { maxPages: 0 } })).toThrow(/maxPages/);
    for (const mode of ["paged", "infinite", "cursor"]) {
      expect(() => mk({ pageSize: 10, mode })).not.toThrow();
    }
  });

  it("F6. snapshot proxy: repeatable reads, contained writes, deep copies, hidden $filters", () => {
    const live: Record<string, unknown> = {
      search: "a",
      tags: ["x"],
      group: { n: 1 },
      $filters: { users: { q: "z" } },
    };
    const snap = createLiveValuesSnapshotProxy(live, { hiddenRootKeys: ["$filters"] });
    const v = snap.proxy;
    expect(v.search).toBe("a");
    live.search = "b";
    expect(v.search).toBe("a"); // repeatable read
    (v.tags as string[]).push("y");
    expect(live.tags).toEqual(["x"]); // contained
    expect((v.group as any).n).toBe(1);
    v.search = "c";
    delete v.search;
    expect(live.search).toBe("b");
    expect(v.$filters).toBeUndefined();
    expect(Object.keys(v)).toEqual(["search", "tags", "group"]);
    expect([...snap.getAccessedPaths()]).toEqual(["search", "tags", "group.n"]);
    expect(snap.getSnapshot("search")).toBe("a");
  });

  it("F7. the executor warns once when a resolver reads its own slot", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = new Palistor({
      config: {
        users: defineList<User>({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: {
            resolver: async (values: any, _s, ctx) => {
              void values.users.length;
              const r = ctx.page!;
              return { items: ALL.slice(r.offset, r.offset + r.pageSize), total: ALL.length };
            },
            pagination: { pageSize: 20 },
          },
        }),
      },
    });
    const list = (store.proxy as any).users;
    void list.items;
    await flushPromises();
    list.setPage(2);
    await flushPromises();
    list.setPage(3);
    await flushPromises();
    expect(list.items.length).toBe(5);
    const selfWarns = warn.mock.calls.filter((c) => String(c[0]).includes("reads its own slot"));
    expect(selfWarns.length).toBe(1);
    // The self slot is excluded from the queryKey — paging never re-keyed.
    const ls = store.nodes.listStates.get((store.rootConfig as any).users)!;
    expect(ls.pagination!.families.size).toBe(1);
    warn.mockRestore();
  });
});
