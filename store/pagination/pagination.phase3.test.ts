/**
 * List pagination — Phase 3 (PaginationPlan.md): per-entity lists & completeness.
 *
 *  K. Nested (per-entity) paginated lists through the shared paged executor
 *     (independent per-owner windows, mutation inversion + owner refs, owner
 *     field / $context queryKey retrigger, reset / reload, infinite, persist
 *     bootstrap, spread keys)
 *  L. Aggregate cross-page `dirty` for paged / cursor
 *  M. `pagination.maxPages` — sliding-window head truncation with tombstones
 *  N. Display-level boundary reflow for paged deletes
 *  O. `options.suspense` for lists
 */
import { describe, it, expect, vi } from "vitest";
import { defineList } from "../defineList";
import { Palistor } from "../store";
import { PAGINATION_SPREAD_KEYS } from "../constants";
import type { ListState, PageMode } from "../store/types";
import type { PageRequest } from "./types";

function flushPromises() {
  return new Promise<void>((r) => setTimeout(r, 0));
}

type User = { id: string; name: string };
/** 45 users → 3 pages of 20 (the last one has 5). */
const ALL: User[] = Array.from({ length: 45 }, (_, i) => ({ id: `u${i + 1}`, name: `User ${i + 1}` }));
/** 100 users — enough for four full pages. */
const MANY: User[] = Array.from({ length: 100 }, (_, i) => ({ id: `u${i + 1}`, name: `User ${i + 1}` }));

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

// ─── Root-list harness (L / M / N / O) ───────────────────────────────────────

interface RootOpts {
  mode?: PageMode;
  pageSize?: number;
  data?: User[];
  total?: boolean;
  readSearch?: boolean;
  deps?: string[];
  pagination?: Record<string, unknown>;
  options?: Record<string, unknown>;
  gate?: boolean;
}

function makeRoot(opts: RootOpts = {}) {
  const pageSize = opts.pageSize ?? 20;
  const mode = opts.mode ?? "paged";
  const calls: PageRequest[] = [];
  const source = { data: opts.data ?? ALL };
  const pending: Array<() => void> = [];
  const resolver = vi.fn(async (values: any, _store: any, ctx: any) => {
    const req = ctx.page as PageRequest;
    calls.push({ ...req });
    let rows = source.data;
    if (opts.readSearch) {
      const s = String(values.search ?? "");
      if (s) rows = rows.filter((u) => u.name.includes(s));
    }
    if (opts.gate) await new Promise<void>((r) => pending.push(r));
    const items = rows.slice(req.offset, req.offset + req.pageSize);
    const result: Record<string, unknown> = { items };
    if (opts.total !== false) result.total = rows.length;
    else result.hasMore = req.offset + items.length < rows.length;
    return result;
  });
  const store = new Palistor({
    config: {
      search: { value: "" },
      users: defineList<User>({
        template: { id: { value: "" }, name: { value: "" } },
        resolve: {
          resolver: resolver as any,
          deps: opts.deps,
          pagination: { pageSize, mode, ...(opts.pagination ?? {}) } as any,
          options: opts.options as any,
        },
      }),
    },
  });
  const list = () => (store.proxy as any).users;
  const ls = (): ListState => store.nodes.listStates.get((store.rootConfig as any).users)!;
  const ids = () => list().items.map((i: any) => i.id);
  const fam = () => {
    const p = ls().pagination!;
    return p.families.get(p.currentQueryKey!)!;
  };
  return { store, list, ls, ids, fam, resolver, calls, source, pending };
}

async function loadRoot(s: ReturnType<typeof makeRoot>) {
  void s.list().items;
  await flushPromises();
}

// ─── Nested-list harness (K) ─────────────────────────────────────────────────

type Order = { id: string; region: string };

/** 45 orders per owner: `<owner>-1 … <owner>-45`, regions alternate eu / us. */
function ordersOf(ownerId: string): Order[] {
  return Array.from({ length: 45 }, (_, i) => ({
    id: `${ownerId}-${i + 1}`,
    region: i % 2 === 0 ? "eu" : "us",
  }));
}

interface NestedOpts {
  mode?: PageMode;
  pageSize?: number;
  /** The resolver filters by the OWNER's `region` field (an auto-dep). */
  readRegion?: boolean;
  /** The resolver excludes ids listed in `store.context.hidden` (a $context dep). */
  readContext?: boolean;
  context?: Record<string, unknown>;
  suspense?: boolean;
}

function makeNested(opts: NestedOpts = {}) {
  const pageSize = opts.pageSize ?? 20;
  const mode = opts.mode ?? "paged";
  const calls: Array<PageRequest & { owner: string }> = [];
  const data = new Map<string, Order[]>();
  const rowsFor = (ownerId: string): Order[] => {
    let rows = data.get(ownerId);
    if (!rows) {
      rows = ordersOf(ownerId);
      data.set(ownerId, rows);
    }
    return rows;
  };
  const resolver = vi.fn(async (owner: any, store: any, ctx: any) => {
    const req = ctx.page as PageRequest;
    calls.push({ ...req, owner: owner.id });
    let rows = rowsFor(owner.id);
    if (opts.readRegion) {
      const region = String(owner.region ?? "");
      if (region) rows = rows.filter((r) => r.region === region);
    }
    if (opts.readContext) {
      const hidden = store.context.hidden as string[] | undefined;
      if (hidden) rows = rows.filter((r) => !hidden.includes(r.id));
    }
    const items = rows.slice(req.offset, req.offset + req.pageSize);
    return { items, total: rows.length };
  });
  const store = new Palistor({
    config: {
      owners: defineList<{ id: string; name: string; region: string }>({
        template: {
          id: { value: "" },
          name: { value: "" },
          region: { value: "" },
          orders: [
            { id: { value: "" }, region: { value: "" } },
            {
              resolve: {
                resolver,
                pagination: { pageSize, mode },
                options: opts.suspense ? { suspense: true } : undefined,
              },
            },
          ],
        } as any,
        resolve: {
          resolver: async () => [
            { id: "o1", name: "A", region: "" },
            { id: "o2", name: "B", region: "" },
          ],
        },
      }),
    },
    context: opts.context,
  });
  const owners = () => (store.proxy as any).owners;
  const owner = (id: string) => owners().getById(id);
  const orders = (id: string) => owner(id).orders;
  const ids = (id: string) => orders(id).items.map((i: any) => i.id);
  const els = (id: string): ListState => {
    const node = store.entityRegistry.get(id)!;
    const listNode = (store.rootConfig as any).owners[0].orders as object;
    return store.entityRegistry.getOrCreateEntityListState(node, listNode);
  };
  const fam = (id: string) => {
    const p = els(id).pagination!;
    return p.families.get(p.currentQueryKey!)!;
  };
  return { store, owners, owner, orders, ids, els, fam, resolver, calls, data };
}

async function loadNested(s: ReturnType<typeof makeNested>, ...ownerIds: string[]) {
  void s.owners().items;
  await flushPromises();
  for (const id of ownerIds) void s.orders(id).items;
  await flushPromises();
}

// ─── K. Nested paginated lists ───────────────────────────────────────────────

describe("K. Nested (per-entity) paginated lists", () => {
  it("K1. each owner gets its own window: ctx.page is delivered, a cached page is a zero-fetch projection", async () => {
    const s = makeNested();
    await loadNested(s, "o1", "o2");
    expect(s.resolver).toHaveBeenCalledTimes(2);
    expect(s.calls.map((c) => c.owner).sort()).toEqual(["o1", "o2"]);
    expect(s.calls[0]).toMatchObject({ page: 1, pageSize: 20, offset: 0 });
    expect(s.ids("o1")).toEqual(ordersOf("o1").slice(0, 20).map((o) => o.id));
    expect(s.ids("o2")[0]).toBe("o2-1");
    expect(s.orders("o1").pageCount).toBe(3);
    expect(s.orders("o1").total).toBe(45);
    expect(s.orders("o1").hasNextPage).toBe(true);

    s.orders("o1").setPage(2);
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(3);
    expect(s.ids("o1")[0]).toBe("o1-21");
    expect(s.orders("o2").page).toBe(1); // untouched

    // Back to page 1: synchronous, zero resolver calls.
    s.orders("o1").setPage(1);
    expect(s.orders("o1").page).toBe(1);
    expect(s.ids("o1")[0]).toBe("o1-1");
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(3);
    // A second read of the same window is a no-op too (per-owner resolve state).
    void s.orders("o1").items;
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(3);
    expect(s.orders("o1").resolveStatus).toBe("resolved");
    expect(s.orders("o1").loading).toBe(false);
  });

  it("K2. mutation inversion with owner refs: add / rekey-promotion / delete reach the per-owner cache and getValues()", async () => {
    const s = makeNested();
    await loadNested(s, "o1");
    const list = s.orders("o1");
    list.add({ region: "eu" }); // tmp id
    const tmpId = s.ids("o1")[20];
    expect(tmpId.startsWith("_tmp_")).toBe(true);
    expect(list.dirty).toBe(true);
    expect(list.total).toBe(46);
    expect(list.serverTotal).toBe(45);
    // The child carries the owner reference (cascade delete / ownership).
    expect(s.store.entityRegistry.get(tmpId)!.owner!.ownerId).toBe("o1");
    // The owner's projection materializes the nested WINDOW.
    const values = s.store.getValues() as any;
    expect(values.owners[0].orders.length).toBe(21);

    // Server confirmation promotes the row (guard unblocked, serverTotal +1).
    list.nextPage();
    await flushPromises();
    s.store.rekey(tmpId, "o1-real");
    list.prevPage();
    expect(s.ids("o1")).toContain("o1-real");
    expect(list.dirty).toBe(false);
    expect(list.serverTotal).toBe(46);

    // Delete reaches an off-screen cached page (page 2 holds o1-25).
    s.store.delete("o1-25");
    expect(list.total).toBe(45);
    list.setPage(2);
    await flushPromises();
    expect(s.ids("o1")).not.toContain("o1-25");
    expect(list.length).toBe(list.items.length);
    expect(s.store.entityRegistry.has("o1-25")).toBe(false);
  });

  it("K3. an OWNER field the resolver read is a queryKey dep: a value change refetches page 1 once, a same-value write is a no-op", async () => {
    const s = makeNested({ readRegion: true });
    await loadNested(s, "o1", "o2");
    s.orders("o1").setPage(2);
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(3);
    // The family keyed on the owner's `region`.
    expect([...s.fam("o1").dependencies]).toContain("region");

    s.owner("o1").region.value = "eu";
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(4);
    expect(s.calls[3]).toMatchObject({ owner: "o1", page: 1, offset: 0 });
    expect(s.orders("o1").page).toBe(1);
    expect(s.ids("o1").every((id: string) => Number(id.split("-")[1]) % 2 === 1)).toBe(true);
    expect(s.orders("o1").total).toBe(23);
    // The sibling owner's list is untouched.
    expect(s.orders("o2").page).toBe(1);
    expect(s.calls.filter((c) => c.owner === "o2").length).toBe(1);

    // Same value → strict no-op.
    s.owner("o1").region.value = "eu";
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(4);
    // A field the resolver never read → no-op.
    s.owner("o1").name.value = "Renamed";
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(4);
  });

  it("K4. a $context dep change (setContext) re-keys every affected nested instance and resets it to page 1", async () => {
    const s = makeNested({ readContext: true, context: { hidden: undefined } });
    await loadNested(s, "o1", "o2");
    s.orders("o1").setPage(2);
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(3);
    expect([...s.fam("o1").dependencies]).toContain("$context.hidden");

    s.store.setContext({ hidden: ["o1-1", "o2-1"] });
    await flushPromises();
    // Both owners' lists were keyed on the context → both refetch page 1, once each.
    expect(s.resolver).toHaveBeenCalledTimes(5);
    expect(s.orders("o1").page).toBe(1);
    expect(s.ids("o1")).not.toContain("o1-1");
    expect(s.ids("o2")).not.toContain("o2-1");
  });

  it("K5. reset() rolls back per-page edits (zero network); reload() is refetch() — exactly one request", async () => {
    const s = makeNested();
    await loadNested(s, "o1");
    const list = s.orders("o1");
    list.setPage(2);
    await flushPromises();
    list.add({ id: "x1", region: "eu" });
    list.remove("o1-22");
    expect(list.dirty).toBe(true);
    s.store.reset();
    expect(list.page).toBe(2);
    expect(list.dirty).toBe(false);
    expect(s.ids("o1")).toEqual(ordersOf("o1").slice(20, 40).map((o) => o.id));
    void list.items;
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(2);

    list.reload();
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(3);
    expect(s.calls[2]).toMatchObject({ owner: "o1", page: 2 });
    // The whole family went stale: page 1 refetches on visit.
    list.setPage(1);
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(4);
  });

  it("K6. infinite mode on a nested list: loadMore accumulates per owner; setItems refuses", async () => {
    const s = makeNested({ mode: "infinite" });
    await loadNested(s, "o1", "o2");
    const list = s.orders("o1");
    expect(list.loadedPages.map((p: any) => p.ordinal)).toEqual([1]);
    list.loadMore();
    await flushPromises();
    expect(s.ids("o1").length).toBe(40);
    expect(list.loadedPages.map((p: any) => p.ordinal)).toEqual([1, 2]);
    expect(s.calls[s.calls.length - 1]).toMatchObject({ owner: "o1", page: 2, offset: 20 });
    expect(s.ids("o2").length).toBe(20);
    list.loadMore();
    await flushPromises();
    expect(s.ids("o1").length).toBe(45);
    expect(list.hasNextPage).toBe(false);
    expect(() => list.setItems(["o1-1"])).toThrow(/infinite/);
  });

  it("K7. persist: a restored nested window bootstraps as a stale family — the first fetch reconciles instead of replacing", async () => {
    const { driver } = memoryDriver();
    const s = makeNested();
    await s.store.persist.enable({ key: "k", driver, debounce: 0 });
    await loadNested(s, "o1");
    s.orders("o1").add({ region: "eu" }); // an un-flushed add: a `_tmp_*` id
    const draft = s.ids("o1")[20];
    expect(draft.startsWith("_tmp_")).toBe(true);
    await s.store.persist.flush();

    const s2 = makeNested();
    await s2.store.persist.enable({ key: "k", driver, debounce: 0 });
    await flushPromises();
    // Restored before any fetch: the draft row is on screen, the list is dirty
    // (a tmp id is never a server row, so it stays out of the baseline).
    expect(s2.resolver).toHaveBeenCalledTimes(0);
    const restored = s2.els("o1");
    expect(restored.pagination).toBeDefined();
    expect(restored.itemIds).toContain(draft);
    expect(s2.orders("o1").resolveStatus).toBe("idle");
    expect(s2.orders("o1").dirty).toBe(true);
    expect(s2.orders("o1").pendingAdds).toEqual([draft]);
    // First access: one fetch that RECONCILES (draft survives, server rows land).
    void s2.orders("o1").items;
    await flushPromises();
    expect(s2.resolver).toHaveBeenCalledTimes(1);
    expect(s2.ids("o1")).toContain(draft);
    expect(s2.ids("o1")).toContain("o1-1");
    expect(s2.ids("o1").length).toBe(21);
    expect(s2.orders("o1").dirty).toBe(true);
    // A row restored under a REAL id is server truth: the reconcile replaces it.
    expect(s2.ids("o1").filter((id: string) => id === draft).length).toBe(1);
  });

  it("K8. the nested proxy advertises the pagination surface; a non-paginated nested list keeps its key set", async () => {
    const s = makeNested();
    await loadNested(s, "o1");
    const keys = Object.keys(s.orders("o1"));
    for (const k of PAGINATION_SPREAD_KEYS) expect(keys).toContain(k);
    expect(keys).not.toContain("loadMore");

    const plain = new Palistor({
      config: {
        owners: defineList<{ id: string }>({
          template: {
            id: { value: "" },
            tags: [{ id: { value: "" } }, { resolve: { resolver: async () => [] } }],
          } as any,
          resolve: { resolver: async () => [{ id: "o1" }] },
        }),
      },
    });
    void (plain.proxy as any).owners.items;
    await flushPromises();
    const tagKeys = Object.keys((plain.proxy as any).owners.getById("o1").tags);
    expect(tagKeys).not.toContain("setPage");
  });
});

// ─── L. Aggregate dirty ──────────────────────────────────────────────────────

describe("L. Aggregate cross-page dirty", () => {
  it("L1. paged: an edit parked on an off-screen page keeps the list dirty; reset clears every page", async () => {
    const s = makeRoot();
    await loadRoot(s);
    s.list().add({ id: "new1", name: "New" });
    s.list().setPage(2);
    await flushPromises();
    expect(s.ids()).not.toContain("new1");
    expect(s.list().dirty).toBe(true);
    expect(s.list().pendingAdds).toEqual(["new1"]);
    // A second edit on page 2 (an un-flushed remove of a server row).
    s.list().remove("u25");
    expect(s.list().dirty).toBe(true);
    s.list().setPage(3);
    await flushPromises();
    expect(s.list().dirty).toBe(true);
    s.store.reset();
    expect(s.list().dirty).toBe(false);
    expect(s.list().page).toBe(3);
    s.list().setPage(2);
    expect(s.ids()).toContain("u25");
    s.list().setPage(1);
    expect(s.ids()).not.toContain("new1");
  });

  it("L2. cursor: the same rollup", async () => {
    const s = makeRoot({ mode: "cursor" });
    await loadRoot(s);
    s.list().add({ id: "new1", name: "New" });
    s.list().nextPage();
    await flushPromises();
    expect(s.list().page).toBe(2);
    expect(s.list().dirty).toBe(true);
    s.list().discardPendingAdds();
    expect(s.list().dirty).toBe(false);
  });
});

// ─── M. maxPages ─────────────────────────────────────────────────────────────

describe("M. pagination.maxPages — sliding-window head truncation", () => {
  it("M1. the window sheds its head; tombstones keep the continuation offset and hasNextPage honest", async () => {
    const s = makeRoot({ mode: "infinite", data: MANY, pagination: { maxPages: 2 } });
    await loadRoot(s);
    s.list().loadMore();
    await flushPromises();
    expect(s.ls().pagination!.loadedOrdinals).toEqual([1, 2]);
    s.list().loadMore();
    await flushPromises();
    expect(s.ls().pagination!.loadedOrdinals).toEqual([2, 3]);
    expect(s.list().loadedPages.map((p: any) => p.ordinal)).toEqual([2, 3]);
    expect(s.ids().length).toBe(40);
    expect(s.ids()[0]).toBe("u21");
    const head = s.fam().pages.get(1)!;
    expect(head.tombstone).toBe(true);
    expect(head.ids).toEqual([]);
    expect(head.fetchedCount).toBe(20);
    expect(s.list().page).toBe(3);
    expect(s.list().hasNextPage).toBe(true);

    // The continuation counts the tombstone: page 4 starts at offset 60.
    s.list().loadMore();
    await flushPromises();
    expect(s.calls[3]).toMatchObject({ page: 4, offset: 60 });
    expect(s.ls().pagination!.loadedOrdinals).toEqual([3, 4]);
    expect(s.fam().pages.get(2)!.tombstone).toBe(true);
    // 100 rows, 5 pages: after page 5 nothing is left (Σ fetchedCount === total).
    s.list().loadMore();
    await flushPromises();
    expect(s.list().hasNextPage).toBe(false);
    expect(s.list().total).toBe(100);
  });

  it("M2. un-flushed local rows of a truncated page are harvested onto the new head (dirty survives)", async () => {
    const s = makeRoot({ mode: "infinite", data: MANY, pagination: { maxPages: 2 } });
    await loadRoot(s);
    s.list().add({ id: "draft", name: "Draft" }); // lands on ordinal 1
    s.list().loadMore();
    await flushPromises();
    s.list().loadMore();
    await flushPromises();
    expect(s.ls().pagination!.loadedOrdinals).toEqual([2, 3]);
    expect(s.ids()[0]).toBe("draft");
    expect(s.ids().length).toBe(41);
    expect(s.list().dirty).toBe(true);
    expect(s.list().pendingAdds).toEqual(["draft"]);
    expect(s.list().hasNextPage).toBe(true);
    // Server truth is unaffected by the local row.
    s.list().loadMore();
    await flushPromises();
    expect(s.calls[3]).toMatchObject({ page: 4, offset: 60 });
  });

  it("M3. refetch() after truncation restarts from the top — one request, tombstones gone", async () => {
    const s = makeRoot({ mode: "infinite", data: MANY, pagination: { maxPages: 2 } });
    await loadRoot(s);
    s.list().loadMore();
    await flushPromises();
    s.list().loadMore();
    await flushPromises();
    s.list().add({ id: "draft", name: "Draft" });
    expect(s.resolver).toHaveBeenCalledTimes(3);
    await s.list().refetch();
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(4);
    expect(s.calls[3]).toMatchObject({ page: 1, offset: 0 });
    expect(s.ls().pagination!.loadedOrdinals).toEqual([1]);
    expect(s.fam().pages.get(1)!.tombstone).toBeUndefined();
    expect(s.fam().pages.has(2)).toBe(false);
    expect(s.fam().pages.has(3)).toBe(false);
    expect(s.ids().length).toBe(21);
    expect(s.ids()).toContain("draft"); // harvested off the dropped pages
    expect(s.ids()[0]).toBe("u1");
    s.list().loadMore();
    await flushPromises();
    expect(s.calls[4]).toMatchObject({ page: 2, offset: 20 });
  });

  it("M4. persist: truncated ordinals ride along as tombstones; persist.maxPages is clamped to maxPages", async () => {
    const { driver, mem } = memoryDriver();
    const cfg = { mode: "infinite" as const, data: MANY, pagination: { maxPages: 2, persist: { maxPages: 5 } } };
    const s = makeRoot(cfg);
    expect(s.ls().pagination!.config.persist).toEqual({ maxPages: 2 });
    await s.store.persist.enable({ key: "k", driver, debounce: 0 });
    await loadRoot(s);
    s.list().loadMore();
    await flushPromises();
    s.list().loadMore();
    await flushPromises();
    await s.store.persist.flush();
    const blob = JSON.parse(mem.get("k")!).__pagination.users;
    expect(blob.pages.map((p: any) => [p.ordinal, p.tombstone === true])).toEqual([
      [1, true],
      [2, false],
      [3, false],
    ]);
    expect(blob.loadedOrdinals).toEqual([2, 3]);

    const s2 = makeRoot(cfg);
    await s2.store.persist.enable({ key: "k", driver, debounce: 0 });
    await flushPromises();
    expect(s2.ls().pagination!.loadedOrdinals).toEqual([2, 3]);
    expect(s2.ids().length).toBe(40);
    expect(s2.ids()[0]).toBe("u21");
    void s2.list().items;
    await flushPromises();
    expect(s2.resolver).toHaveBeenCalledTimes(0);
    s2.list().loadMore();
    await flushPromises();
    expect(s2.calls[0]).toMatchObject({ page: 4, offset: 60 });
    expect(s2.ls().pagination!.loadedOrdinals).toEqual([3, 4]);
  });

  it("M5. tombstones are never LRU-evicted, never re-fetched in place (prefetch / revalidate no-op)", async () => {
    const s = makeRoot({
      mode: "infinite",
      data: MANY,
      pagination: { maxPages: 2, maxCachedPages: 2, staleTime: 1 },
    });
    await loadRoot(s);
    s.list().loadMore();
    await flushPromises();
    s.list().loadMore();
    await flushPromises();
    s.list().loadMore();
    await flushPromises();
    expect(s.fam().pages.get(1)!.tombstone).toBe(true);
    expect(s.fam().pages.get(2)!.tombstone).toBe(true);
    expect(s.resolver).toHaveBeenCalledTimes(4);
    await s.list().prefetch(1);
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(4);
    s.store.resolveManager.revalidatePaginated(s.ls(), 2);
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(4);
    expect(s.ls().pagination!.loadedOrdinals).toEqual([3, 4]);
  });

  it("M6. config: maxPages must be a positive integer; paged / cursor ignore it", () => {
    expect(() => makeRoot({ mode: "infinite", pagination: { maxPages: 0 } })).toThrow(/maxPages/);
    expect(() => makeRoot({ mode: "infinite", pagination: { maxPages: 1.5 } })).toThrow(/maxPages/);
    const s = makeRoot({ mode: "paged", pagination: { maxPages: 1 } });
    expect(s.ls().pagination!.config.maxPages).toBe(1);
  });

  it("M7. paged/cursor: maxPages never truncates a paged family", async () => {
    const s = makeRoot({ mode: "paged", pagination: { maxPages: 1 } });
    await loadRoot(s);
    s.list().setPage(2);
    await flushPromises();
    s.list().setPage(3);
    await flushPromises();
    expect(s.fam().pages.size).toBe(3);
    expect([...s.fam().pages.values()].every((e) => !e.tombstone)).toBe(true);
  });
});

// ─── N. Boundary reflow ──────────────────────────────────────────────────────

describe("N. Display-level boundary reflow for paged deletes", () => {
  it("N1. a deleted server row is replaced on screen by the stale successor's head — no entry is written", async () => {
    const s = makeRoot();
    await loadRoot(s);
    s.list().setPage(2);
    await flushPromises();
    s.list().setPage(1);
    // Server-confirmed delete: the mock server loses the row too.
    s.source.data = s.source.data.filter((u) => u.id !== "u2");
    s.store.delete("u2");
    expect(s.list().total).toBe(44);
    expect(s.list().length).toBe(20);
    expect(s.ids()[19]).toBe("u21");
    expect(s.ids()).not.toContain("u2");
    // Display-level: page 1's entry holds 19 rows, page 2's entry is intact (stale).
    expect(s.fam().pages.get(1)!.ids.length).toBe(19);
    expect(s.fam().pages.get(2)!.ids.length).toBe(20);
    expect(s.fam().pages.get(2)!.status).toBe("stale");
    expect(s.list().dirty).toBe(false);
    expect(s.store.getValues().users.length).toBe(20);
    expect(s.list().getById("u21")).toBeDefined();
  });

  it("N2. once the successor is refetched the borrow ends and the short page heals on its next visit", async () => {
    const s = makeRoot();
    await loadRoot(s);
    s.list().setPage(2);
    await flushPromises();
    s.list().setPage(1);
    s.source.data = s.source.data.filter((u) => u.id !== "u2");
    s.store.delete("u2");
    expect(s.ids()[19]).toBe("u21");

    s.list().setPage(2);
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(3);
    expect(s.ids()[0]).toBe("u22"); // the server shifted page 2
    expect(s.ids()).not.toContain("u21");
    // Page 1 is short of server truth → marked stale for its next visit.
    expect(s.fam().pages.get(1)!.status).toBe("stale");
    s.list().setPage(1);
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(4);
    expect(s.ids().length).toBe(20);
    expect(s.ids()[19]).toBe("u21");
    expect(s.fam().pages.get(1)!.status).toBe("fresh");
    // No row is served on two pages.
    s.list().setPage(2);
    expect(s.ids()[0]).toBe("u22");
  });

  it("N3. the last page never borrows; a local remove() borrows too; removing a borrowed row works", async () => {
    const s = makeRoot();
    await loadRoot(s);
    s.list().setPage(3);
    await flushPromises();
    s.store.delete("u45");
    expect(s.list().length).toBe(4);

    s.list().setPage(2);
    await flushPromises();
    s.list().setPage(1);
    s.list().remove("u3"); // un-flushed local remove — later pages go stale
    expect(s.list().length).toBe(20);
    expect(s.ids()[19]).toBe("u21");
    expect(s.list().dirty).toBe(true);
    // Removing the borrowed row splices page 2's entry; the next head is borrowed.
    s.list().remove("u21");
    expect(s.fam().pages.get(2)!.ids).not.toContain("u21");
    expect(s.ids()[19]).toBe("u22");
    expect(s.list().length).toBe(20);
  });
});

// ─── O. Suspense ─────────────────────────────────────────────────────────────

describe("O. options.suspense for lists", () => {
  it("O1. a paginated list suspends only while nothing is renderable", async () => {
    const s = makeRoot({ gate: true, readSearch: true, options: { suspense: true } });
    // First read: idle → the lazy trigger is queued, nothing thrown yet.
    expect(() => s.list().items).not.toThrow();
    await Promise.resolve();
    // Pending with an empty window → suspend on the run's promise.
    let thrown: unknown;
    try {
      void s.list().items;
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Promise);
    expect(s.list().isInitialLoading).toBe(true);
    s.pending.shift()!();
    await thrown;
    await flushPromises();
    expect(s.ids().length).toBe(20);

    // A page navigation keeps the window on screen: no suspension.
    s.list().setPage(2);
    expect(() => s.list().items).not.toThrow();
    expect(s.list().isFetching).toBe(true);
    s.pending.shift()!();
    await flushPromises();
    expect(s.ids()[0]).toBe("u21");

    // A queryKey change (no keepPreviousData) empties the window → suspends again.
    (s.store.proxy as any).search.value = "1";
    await flushPromises();
    let again: unknown;
    try {
      void s.list().items;
    } catch (e) {
      again = e;
    }
    expect(again).toBeInstanceOf(Promise);
    s.pending.shift()!();
    await again;
    await flushPromises();
    expect(s.ids().length).toBeGreaterThan(0);
  });

  it("O2. a plain root list suspends while pending; without the option nothing throws", async () => {
    let release!: () => void;
    const mk = (suspense: boolean) =>
      new Palistor({
        config: {
          users: defineList<User>({
            template: { id: { value: "" }, name: { value: "" } },
            resolve: {
              resolver: async () => {
                await new Promise<void>((r) => (release = r));
                return ALL.slice(0, 3);
              },
              options: suspense ? { suspense: true } : undefined,
            },
          }),
        },
      });
    const store = mk(true);
    void (store.proxy as any).users.items;
    await Promise.resolve();
    let thrown: unknown;
    try {
      void (store.proxy as any).users.items;
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Promise);
    release();
    await flushPromises();
    expect((store.proxy as any).users.length).toBe(3);

    const plain = mk(false);
    void (plain.proxy as any).users.items;
    await Promise.resolve();
    expect(() => (plain.proxy as any).users.items).not.toThrow();
    release();
    await flushPromises();
  });

  it("O3. a nested list suspends too (paginated and plain)", async () => {
    const s = makeNested({ suspense: true });
    void s.owners().items;
    await flushPromises();
    void s.orders("o1").items; // queue the lazy trigger
    await Promise.resolve();
    let thrown: unknown;
    try {
      void s.orders("o1").items;
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Promise);
    await flushPromises();
    expect(s.ids("o1").length).toBe(20);

    let release!: () => void;
    const plain = new Palistor({
      config: {
        owners: defineList<{ id: string }>({
          template: {
            id: { value: "" },
            tags: [
              { id: { value: "" } },
              {
                resolve: {
                  resolver: async () => {
                    await new Promise<void>((r) => (release = r));
                    return [{ id: "t1" }];
                  },
                  options: { suspense: true },
                },
              },
            ],
          } as any,
          resolve: { resolver: async () => [{ id: "o1" }] },
        }),
      },
    });
    void (plain.proxy as any).owners.items;
    await flushPromises();
    const tags = () => (plain.proxy as any).owners.getById("o1").tags;
    void tags().items;
    await Promise.resolve();
    let nestedThrown: unknown;
    try {
      void tags().items;
    } catch (e) {
      nestedThrown = e;
    }
    expect(nestedThrown).toBeInstanceOf(Promise);
    release();
    await flushPromises();
    expect(tags().length).toBe(1);
  });
});
