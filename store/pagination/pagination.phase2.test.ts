/**
 * List pagination — Phase 2 (PaginationPlan.md): richer modes & cache lifecycle.
 *
 *  G. infinite mode (loadMore, window membership, per-page dirty, continuation)
 *  H. cursor mode (chain threading, free prevPage, truncating invalidation)
 *  I. cache lifecycle (prefetch, setPageSize, keepPreviousData, staleTime SWR,
 *     multi-family retention + gcTime)
 *  J. persist Phase 2 (multi-page blob, bounded tail, pendingAdds, onError +
 *     quota retry, revalidateOnHydrate, hydrated-cursor fallback, scroll anchor)
 */
import { describe, it, expect, vi } from "vitest";
import { defineList } from "../defineList";
import { Palistor } from "../store";
import { INFINITE_SPREAD_KEYS } from "../constants";
import type { ListState, PageMode } from "../store/types";
import type { PageRequest } from "./types";

function flushPromises() {
  return new Promise<void>((r) => setTimeout(r, 0));
}

type User = { id: string; name: string };

/** 45 users → 3 pages of 20 (the last one has 5). */
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

interface StoreOpts {
  mode?: PageMode;
  pageSize?: number;
  /** cursor-threading resolver (`nextCursor` = the next start index). */
  cursors?: boolean;
  /** Report `total` (server truth) — off means `hasMore`/fullness heuristics. */
  total?: boolean;
  /** Every call parks on a deferred the test resolves. */
  gate?: boolean;
  /** Fail the n-th call (1-based). */
  failOn?: number;
  /** Reject any request carrying a cursor from this set (a stale hydrated cursor). */
  rejectCursors?: Set<string>;
  /** Cursor nonce — a refetched page mints `<index>@<epoch>`, never the old string. */
  cursorEpoch?: number;
  /** Reject EVERY cursor: the chain can never be rebuilt. */
  rejectAllCursors?: boolean;
  data?: User[];
  readSearch?: boolean;
  deps?: string[];
  pagination?: Record<string, unknown>;
  context?: Record<string, unknown>;
  extraConfig?: Record<string, unknown>;
}

function makeStore(opts: StoreOpts = {}) {
  const pageSize = opts.pageSize ?? 20;
  const mode = opts.mode ?? "infinite";
  const calls: PageRequest[] = [];
  const pending: Deferred[] = [];
  const source = { data: opts.data ?? ALL };

  const resolver = vi.fn(async (values: any, _store: any, ctx: any) => {
    const req = ctx.page as PageRequest;
    calls.push({ ...req });
    if (opts.failOn && calls.length === opts.failOn) throw new Error("boom");
    if (req.cursor != null && (opts.rejectAllCursors || opts.rejectCursors?.has(req.cursor))) {
      throw new Error("cursor expired");
    }
    let rows = source.data;
    if (opts.readSearch) {
      const s = String(values.search ?? "");
      if (s) rows = rows.filter((u) => u.name.includes(s));
    }
    if (opts.gate) {
      const d = deferred();
      pending.push(d);
      await d.promise;
    }
    const start = opts.cursors
      ? req.cursor == null
        ? 0
        : Number(String(req.cursor).split("@")[0])
      : req.offset;
    const items = rows.slice(start, start + req.pageSize);
    const nextStart = start + items.length;
    const result: Record<string, unknown> = { items };
    if (opts.total) result.total = rows.length;
    if (opts.cursors) {
      result.nextCursor =
        nextStart < rows.length ? `${nextStart}@${opts.cursorEpoch ?? 1}` : null;
    }
    else result.hasMore = nextStart < rows.length;
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
        },
      }),
      ...(opts.extraConfig ?? {}),
    },
    context: opts.context,
  });
  const list = () => (store.proxy as any).users;
  const ls = (): ListState => store.nodes.listStates.get((store.rootConfig as any).users)!;
  const ids = () => list().items.map((i: any) => i.id);
  const fam = () => {
    const p = ls().pagination!;
    return p.families.get(p.currentQueryKey!)!;
  };
  return { store, list, ls, ids, fam, resolver, calls, pending, source };
}

type Store = ReturnType<typeof makeStore>;

async function load(s: Store) {
  void s.list().items; // lazy trigger
  await flushPromises();
}

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

// ─── G. infinite mode ────────────────────────────────────────────────────────

describe("G. infinite mode", () => {
  it("G1. loadMore accumulates the window; the ordinal joins only on success", async () => {
    const s = makeStore({ total: true });
    await load(s);
    expect(s.ids().length).toBe(20);
    expect(s.list().page).toBe(1);
    expect(s.list().hasNextPage).toBe(true);

    s.list().loadMore();
    await flushPromises();
    expect(s.calls[1]).toMatchObject({ page: 2, offset: 20 });
    expect(s.ids().length).toBe(40);
    expect(s.ids()[20]).toBe("u21");
    expect(s.list().page).toBe(2);
    expect(s.ls().pagination!.loadedOrdinals).toEqual([1, 2]);
    expect(s.list().loadedPages.map((p: any) => p.ordinal)).toEqual([1, 2]);

    s.list().loadMore();
    await flushPromises();
    expect(s.ids().length).toBe(45);
    expect(s.list().hasNextPage).toBe(false);
    s.list().loadMore();
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(3); // no guaranteed-empty fetch
  });

  it("G2. a failed loadMore keeps the window; the retry re-targets the SAME ordinal", async () => {
    const s = makeStore({ total: true, failOn: 2 });
    await load(s);
    s.list().loadMore();
    await flushPromises();
    expect(s.ls().pagination!.loadedOrdinals).toEqual([1]);
    expect(s.ids().length).toBe(20);
    expect(s.list().error).toBeInstanceOf(Error);

    s.list().loadMore();
    await flushPromises();
    expect(s.calls[2]).toMatchObject({ page: 2 }); // never skipped to 3
    expect(s.ls().pagination!.loadedOrdinals).toEqual([1, 2]);
    expect(s.ids().length).toBe(40);
  });

  it("G3. loadMore is a no-op while one is in flight; isFetchingNextPage tracks it", async () => {
    const s = makeStore({ total: true, gate: true });
    void s.list().items;
    await flushPromises();
    s.pending[0].resolve(undefined);
    await flushPromises();

    s.list().loadMore();
    expect(s.list().isFetchingNextPage).toBe(true);
    expect(s.list().isInitialLoading).toBe(false);
    s.list().loadMore();
    s.list().loadMore();
    expect(s.resolver).toHaveBeenCalledTimes(2);
    s.pending[1].resolve(undefined);
    await flushPromises();
    expect(s.list().isFetchingNextPage).toBe(false);
    expect(s.ids().length).toBe(40);
  });

  it("G4. an in-window completion still projects, whatever the order (membership gate)", async () => {
    const s = makeStore({ total: true, gate: true });
    void s.list().items;
    await flushPromises();
    s.pending[0].resolve(undefined);
    await flushPromises();
    s.list().loadMore();
    await flushPromises();
    s.pending[1].resolve(undefined);
    await flushPromises();
    expect(s.ids().length).toBe(40);

    // A background revalidation of ordinal 1 (no longer the "current" page)
    // races the next `loadMore` and completes last. The paged gate would drop
    // it and leave the fetched rows invisible in cache.
    s.fam().pages.get(1)!.status = "stale";
    s.source.data = [{ id: "fresh1", name: "Fresh" }, ...ALL.slice(1)];
    s.store.resolveManager.revalidatePaginated(s.ls(), 1);
    await flushPromises();
    s.list().loadMore(); // ordinal 3
    await flushPromises();

    s.pending[3].resolve(undefined); // ordinal 3 first
    await flushPromises();
    expect(s.ls().pagination!.loadedOrdinals).toEqual([1, 2, 3]);
    s.pending[2].resolve(undefined); // ordinal 1 last — still projects
    await flushPromises();
    expect(s.ids()[0]).toBe("fresh1");
    expect(s.ids().length).toBe(45);
  });

  it("G4b. a prefetch of the next ordinal fills the cache without moving the window", async () => {
    const s = makeStore({ total: true });
    await load(s);
    await s.list().prefetch(2);
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(2);
    expect(s.ls().pagination!.loadedOrdinals).toEqual([1]);
    expect(s.ids().length).toBe(20); // the warmup never scrolls the feed

    s.list().loadMore();
    expect(s.resolver).toHaveBeenCalledTimes(2); // claimed from cache
    expect(s.ids().length).toBe(40);

    // Unreachable ordinals are refused rather than fetched at a wrong offset.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await s.list().prefetch(5);
    expect(s.resolver).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("unreachable"))).toBe(true);
    warn.mockRestore();
  });

  it("G5. hasNextPage is immune to optimistic edits; an empty page never wipes the window", async () => {
    const s = makeStore({ total: true, data: ALL.slice(0, 20) });
    await load(s);
    expect(s.list().hasNextPage).toBe(false);
    s.list().add({ id: "new", name: "N" });
    expect(s.list().total).toBe(21); // display total moves
    expect(s.list().serverTotal).toBe(20);
    expect(s.list().hasNextPage).toBe(false); // never a phantom next page
    expect(s.ids().length).toBe(21);

    // An empty page result is an ordinary end-of-feed signal, not the legacy wipe.
    const s2 = makeStore({ data: ALL.slice(0, 40) });
    await load(s2);
    s2.list().loadMore();
    await flushPromises();
    expect(s2.ids().length).toBe(40);
    // The feed ended exactly on a page boundary: force ordinal 3 and assert the
    // empty result is stored as `{ids: []}` and touches nothing else.
    await s2.store.resolveManager.triggerPagedFetch(s2.ls(), 3);
    await flushPromises();
    expect(s2.calls.length).toBe(3);
    const empty = s2.fam().pages.get(3)!;
    expect(empty.ids).toEqual([]);
    expect(empty.hasMore).toBe(false);
    expect(s2.ids().length).toBe(40); // window intact — never the legacy wipe
    expect(s2.list().hasNextPage).toBe(false);
  });

  it("G6. setItems on an infinite list throws (no correct per-page assignment)", async () => {
    const s = makeStore({ total: true });
    await load(s);
    expect(() => s.list().setItems(["u2", "u1"])).toThrow(/infinite/);
    expect(s.ids()[0]).toBe("u1");
  });

  it("G7. dirty is the per-page rollup, and refetch reconciles un-flushed adds", async () => {
    const s = makeStore({ total: true });
    await load(s);
    s.list().loadMore();
    await flushPromises();
    expect(s.list().dirty).toBe(false);

    s.list().add({ id: "draft", name: "D" }); // lands on the LAST loaded ordinal
    expect(s.fam().pages.get(2)!.ids).toContain("draft");
    expect(s.list().dirty).toBe(true);

    // A pure window compare would read equal here; the rollup does not.
    const entry = s.fam().pages.get(1)!;
    entry.ids = [...entry.initialIds, "u21"]; // duplicate collapsed by dedupe
    expect(s.list().dirty).toBe(true);

    entry.ids = [...entry.initialIds];
    await s.list().refetch();
    await flushPromises();
    // Pull-to-refresh: back to one ordinal, exactly one request, the local row
    // harvested off the dropped page.
    expect(s.ls().pagination!.loadedOrdinals).toEqual([1]);
    expect(s.calls.length).toBe(3);
    expect(s.ids()).toContain("draft");
    expect(s.ids().length).toBe(21);
  });

  it("G8. the continuation counter is Σ fetchedCount, immune to cross-page dedup", async () => {
    const s = makeStore();
    await load(s);
    s.list().loadMore();
    await flushPromises();
    // A revalidation of ordinal 1 returns rows that already sit on ordinal 2:
    // the stored ids shrink, `fetchedCount` does not.
    s.fam().pages.get(1)!.status = "stale";
    s.source.data = [...ALL.slice(18, 20), ...ALL.slice(20, 38), ...ALL.slice(38)];
    s.store.resolveManager.revalidatePaginated(s.ls(), 1);
    await flushPromises();
    const e1 = s.fam().pages.get(1)!;
    expect(e1.fetchedCount).toBe(20);
    expect(e1.ids.length).toBeLessThan(20); // dedup dropped the moved rows
    s.list().loadMore();
    await flushPromises();
    expect(s.calls[s.calls.length - 1].offset).toBe(40); // Σ fetchedCount, not Σ|ids|
  });

  it("G9. a mid-flight delete of a loaded row reissues the continuation at the corrected offset", async () => {
    const s = makeStore({ gate: true });
    void s.list().items;
    await flushPromises();
    s.pending[0].resolve(undefined);
    await flushPromises();

    s.list().loadMore();
    await flushPromises();
    expect(s.calls[1].offset).toBe(20);
    s.store.delete("u5"); // a server row of the loaded page
    s.pending[1].resolve(undefined);
    await flushPromises();
    // Discarded, then reissued at 19.
    expect(s.calls.length).toBe(3);
    expect(s.calls[2]).toMatchObject({ page: 2, offset: 19 });
    s.pending[2].resolve(undefined);
    await flushPromises();
    expect(s.ls().pagination!.loadedOrdinals).toEqual([1, 2]);
  });

  it("G10. window ordinals are pinned from LRU eviction", async () => {
    const s = makeStore({ total: true, pagination: { maxCachedPages: 1 } });
    await load(s);
    s.list().loadMore();
    await flushPromises();
    s.list().loadMore();
    await flushPromises();
    expect([...s.fam().pages.keys()].sort()).toEqual([1, 2, 3]);
    expect(s.ids().length).toBe(45);
  });

  it("G12. a rekey promotion landing during a refetch counts the row once", async () => {
    // A complete feed: 19 rows in one page of 20. The optimistic add is
    // confirmed by the server (rekey) WHILE that page's refetch is in flight.
    const s = makeStore({ total: true, gate: true, data: ALL.slice(0, 19) });
    void s.list().items;
    await flushPromises();
    s.pending[0].resolve(undefined);
    await flushPromises();
    expect(s.list().serverTotal).toBe(19);
    expect(s.list().hasNextPage).toBe(false);

    s.list().add({ id: "tmp", name: "Draft" });
    expect(s.list().total).toBe(20);
    expect(s.list().serverTotal).toBe(19);

    // The POST succeeded server-side; the refetch therefore sees 21 rows, and
    // the rekey (the client's confirmation) lands while it is in flight.
    s.source.data = [...ALL.slice(0, 19), { id: "u20", name: "Draft" }];
    void s.list().refetch();
    await flushPromises();
    s.store.rekey("tmp", "u20");
    expect(s.fam().pages.get(1)!.initialIds).toContain("u20");
    expect(s.list().serverTotal).toBe(20);

    s.pending[1].resolve(undefined);
    await flushPromises();
    // Counted ONCE — not 21 — so the complete feed reports no next page (the
    // guaranteed-empty fetch derived accounting exists to prevent).
    expect(s.list().serverTotal).toBe(20);
    expect(s.list().total).toBe(20);
    expect(s.list().dirty).toBe(false);
    expect(s.list().hasNextPage).toBe(false);
  });

  it("G11. spread keys carry the infinite surface only for an infinite list", async () => {
    const inf = makeStore();
    const paged = makeStore({ mode: "paged" });
    for (const k of INFINITE_SPREAD_KEYS) {
      expect(Object.keys(inf.list())).toContain(k);
      expect(Object.keys(paged.list())).not.toContain(k);
    }
    expect(paged.list().loadMore).toBeUndefined();
  });
});

// ─── H. cursor mode ──────────────────────────────────────────────────────────

describe("H. cursor mode", () => {
  it("H1. the chain is threaded; prevPage is always a cache hit", async () => {
    const s = makeStore({ mode: "cursor", cursors: true });
    await load(s);
    expect(s.calls[0].cursor).toBe(null);
    expect(s.list().hasNextPage).toBe(true);

    s.list().nextPage();
    await flushPromises();
    expect(s.calls[1].cursor).toBe("20@1");
    expect(s.ids()).toEqual(ALL.slice(20, 40).map((u) => u.id));
    expect(s.list().page).toBe(2);
    expect(s.list().hasPrevPage).toBe(true);

    s.list().prevPage();
    expect(s.resolver).toHaveBeenCalledTimes(2); // synchronous cache hit
    expect(s.ids()).toEqual(ALL.slice(0, 20).map((u) => u.id));

    s.list().nextPage();
    expect(s.resolver).toHaveBeenCalledTimes(2); // cached forward too
    expect(s.list().page).toBe(2);
  });

  it("H2. random access into an unreachable ordinal is refused (chains are sequential)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = makeStore({ mode: "cursor", cursors: true });
    await load(s);
    s.list().setPage(3);
    await flushPromises();
    expect(s.list().page).toBe(1);
    expect(s.resolver).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("unreachable"))).toBe(true);
    warn.mockRestore();
  });

  it("H3. invalidate is TRUNCATING and supersedes an orphan continuation", async () => {
    const s = makeStore({ mode: "cursor", cursors: true, gate: true });
    void s.list().items;
    await flushPromises();
    s.pending[0].resolve(undefined);
    await flushPromises();
    s.list().nextPage();
    await flushPromises();
    s.pending[1].resolve(undefined);
    await flushPromises();
    s.list().nextPage(); // ordinal 3, in flight off page 2's cursor
    await flushPromises();
    expect(s.fam().pages.size).toBe(2);

    s.list().invalidate(1); // drops everything after ordinal 1
    const inFlight = s.pending.length;
    s.pending[inFlight - 1].resolve(undefined); // the orphan completes
    await flushPromises();
    const p = s.ls().pagination!;
    expect(p.currentPage).toBe(1);
    expect([...s.fam().pages.keys()]).toEqual([1]);
    expect(s.ids().length).toBe(20);
    expect(s.ids()[0]).toBe("u1"); // no 20-row gap filed into the window
  });

  it("H4. refetch on a cursor chain is one request back at the head", async () => {
    const s = makeStore({ mode: "cursor", cursors: true });
    await load(s);
    s.list().nextPage();
    await flushPromises();
    const before = s.resolver.mock.calls.length;
    await s.list().refetch();
    await flushPromises();
    expect(s.resolver.mock.calls.length).toBe(before + 1);
    expect(s.list().page).toBe(1);
    expect(s.ids()).toEqual(ALL.slice(0, 20).map((u) => u.id));
  });
});

// ─── I. cache lifecycle ──────────────────────────────────────────────────────

describe("I. cache lifecycle", () => {
  it("I1. prefetch fills the cache without moving the pointer; the visit is then free", async () => {
    const s = makeStore({ mode: "paged", total: true });
    await load(s);
    await s.list().prefetch(2);
    await flushPromises();
    expect(s.list().page).toBe(1);
    expect(s.ids()).toEqual(ALL.slice(0, 20).map((u) => u.id));
    expect(s.resolver).toHaveBeenCalledTimes(2);

    s.list().setPage(2);
    expect(s.resolver).toHaveBeenCalledTimes(2); // synchronous projection
    expect(s.ids()).toEqual(ALL.slice(20, 40).map((u) => u.id));
    await s.list().prefetch(2); // already fresh
    expect(s.resolver).toHaveBeenCalledTimes(2);
  });

  it("I2. setPageSize clears the cache and refetches once from initialPage", async () => {
    const s = makeStore({ mode: "paged", total: true });
    await load(s);
    s.list().setPage(2);
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(2);

    s.list().setPageSize(10);
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(3);
    expect(s.calls[2]).toMatchObject({ page: 1, pageSize: 10, offset: 0 });
    expect(s.list().pageSize).toBe(10);
    expect(s.list().page).toBe(1);
    expect(s.ids().length).toBe(10);
    expect(s.list().pageCount).toBe(5);
  });

  it("I2b. setPageSize on an infinite list restarts the feed at the new size", async () => {
    const s = makeStore({ total: true });
    await load(s);
    s.list().loadMore();
    await flushPromises();
    expect(s.ids().length).toBe(40);

    s.list().setPageSize(5);
    await flushPromises();
    expect(s.ls().pagination!.loadedOrdinals).toEqual([1]);
    expect(s.ids().length).toBe(5);
    expect(s.calls[2]).toMatchObject({ page: 1, pageSize: 5, offset: 0 });
    s.list().loadMore();
    await flushPromises();
    expect(s.calls[3]).toMatchObject({ page: 2, pageSize: 5, offset: 5 });
    expect(s.ids().length).toBe(10);
  });

  it("I3. keepPreviousData renders the old window (flagged) until the new key lands", async () => {
    const s = makeStore({
      mode: "paged",
      total: true,
      gate: true,
      readSearch: true,
      deps: ["search"],
      pagination: { keepPreviousData: true },
    });
    void s.list().items;
    await flushPromises();
    s.pending[0].resolve(undefined);
    await flushPromises();
    expect(s.ids().length).toBe(20);
    expect(s.list().isPreviousData).toBe(false);

    (s.store.proxy as any).search.value = "User 1";
    await flushPromises();
    expect(s.list().isPreviousData).toBe(true);
    expect(s.ids().length).toBe(20); // previous rows still on screen
    expect(s.list().isInitialLoading).toBe(false);
    s.pending[1].resolve(undefined);
    await flushPromises();
    expect(s.list().isPreviousData).toBe(false);
    expect(s.ids().every((id: string) => id !== "u2")).toBe(true);
  });

  it("I3b. without the opt-in a queryKey change clears the window immediately", async () => {
    const s = makeStore({
      mode: "paged",
      total: true,
      gate: true,
      readSearch: true,
      deps: ["search"],
    });
    void s.list().items;
    await flushPromises();
    s.pending[0].resolve(undefined);
    await flushPromises();
    (s.store.proxy as any).search.value = "User 1";
    await flushPromises();
    expect(s.ids()).toEqual([]);
    expect(s.list().isInitialLoading).toBe(true);
  });

  it("I4. a page past staleTime is SERVED and revalidated in the background", async () => {
    const s = makeStore({ mode: "paged", total: true, pagination: { staleTime: 5 } });
    await load(s);
    s.list().setPage(2);
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(2);

    await new Promise((r) => setTimeout(r, 10));
    s.list().setPage(1);
    // Served synchronously from cache — no skeleton, no blocking fetch.
    expect(s.ids()).toEqual(ALL.slice(0, 20).map((u) => u.id));
    expect(s.list().page).toBe(1);
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(3); // revalidated behind it
    expect(s.calls[2]).toMatchObject({ page: 1 });
  });

  it("I5. multi-family retention serves a flip back to an old filter from cache; gcTime drops it", async () => {
    const s = makeStore({
      mode: "paged",
      total: true,
      readSearch: true,
      deps: ["search"],
      pagination: { maxCachedQueries: 2 },
    });
    await load(s);
    (s.store.proxy as any).search.value = "User 1";
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(2);
    (s.store.proxy as any).search.value = "";
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(2); // served from the retained family
    expect(s.ids()).toEqual(ALL.slice(0, 20).map((u) => u.id));

    const gc = makeStore({
      mode: "paged",
      total: true,
      readSearch: true,
      deps: ["search"],
      pagination: { maxCachedQueries: 2, gcTime: 5 },
    });
    await load(gc);
    (gc.store.proxy as any).search.value = "User 1";
    await flushPromises();
    expect(gc.ls().pagination!.families.size).toBe(2);
    await new Promise((r) => setTimeout(r, 15));
    expect(gc.ls().pagination!.families.size).toBe(1);
    (gc.store.proxy as any).search.value = "";
    await flushPromises();
    expect(gc.resolver).toHaveBeenCalledTimes(3); // the evicted family refetches
  });
});

// ─── J. persist (Phase 2) ────────────────────────────────────────────────────

describe("J. persist", () => {
  it("J1. an infinite window round-trips whole and hydration does not evict itself", async () => {
    const { driver } = memoryDriver();
    const s = makeStore({
      total: true,
      readSearch: true,
      deps: ["search"],
      pagination: { persist: "window" },
    });
    await s.store.persist.enable({ key: "k", driver, debounce: 0 });
    await load(s);
    s.list().loadMore();
    await flushPromises();
    s.list().setScrollAnchor("u25");
    await s.store.persist.flush();

    const s2 = makeStore({
      total: true,
      readSearch: true,
      deps: ["search"],
      pagination: { persist: "window" },
    });
    await s2.store.persist.enable({ key: "k", driver, debounce: 0 });
    await flushPromises();
    expect(s2.ls().pagination!.loadedOrdinals).toEqual([1, 2]);
    expect(s2.ids().length).toBe(40);
    expect(s2.list().page).toBe(2);
    expect(s2.list().scrollAnchor).toBe("u25");
    void s2.list().items;
    await flushPromises();
    expect(s2.resolver).toHaveBeenCalledTimes(0);

    // The chain continues from the restored window.
    s2.list().loadMore();
    await flushPromises();
    expect(s2.calls[0]).toMatchObject({ page: 3, offset: 40 });
    expect(s2.ids().length).toBe(45);
  });

  it("J2. the default bounded persist keeps a tail plus fetchedCount tombstones", async () => {
    const { driver, mem } = memoryDriver();
    const s = makeStore({ total: true, pagination: { persist: { maxPages: 1 } } });
    await s.store.persist.enable({ key: "k", driver, debounce: 0 });
    await load(s);
    s.list().loadMore();
    await flushPromises();
    await s.store.persist.flush();
    const blob = JSON.parse(mem.get("k")!).__pagination.users;
    expect(blob.pages.map((p: any) => p.tombstone === true)).toEqual([true, false]);
    expect(blob.pages[0].fetchedCount).toBe(20);

    const s2 = makeStore({ total: true, pagination: { persist: { maxPages: 1 } } });
    await s2.store.persist.enable({ key: "k", driver, debounce: 0 });
    await flushPromises();
    expect(s2.ids().length).toBe(20); // only the tail is rendered
    expect(s2.ids()[0]).toBe("u21");
    s2.list().loadMore();
    await flushPromises();
    // The tombstone kept the continuation honest.
    expect(s2.calls[0]).toMatchObject({ page: 3, offset: 40 });
  });

  it("J3. pending adds survive the reload, are named once, and are escapable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { driver } = memoryDriver();
    const s = makeStore({ mode: "paged", total: true });
    await s.store.persist.enable({ key: "k", driver, debounce: 0 });
    await load(s);
    s.list().add({ id: "tmp1", name: "Draft" });
    await s.store.persist.flush();

    const s2 = makeStore({ mode: "paged", total: true });
    await s2.store.persist.enable({ key: "k", driver, debounce: 0 });
    await flushPromises();
    expect(s2.ids().filter((id: string) => id === "tmp1").length).toBe(1);
    expect(s2.list().pendingAdds).toEqual(["tmp1"]);
    expect(s2.list().dirty).toBe(true);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("tmp1")).length).toBe(1);

    await s2.list().refetch();
    await flushPromises();
    expect(s2.ids().filter((id: string) => id === "tmp1").length).toBe(1); // never doubled
    s2.list().discardPendingAdds();
    expect(s2.list().pendingAdds).toEqual([]);
    expect(s2.list().dirty).toBe(false);
    warn.mockRestore();
  });

  it("J3b. persistPendingAdds: 'drop' leaves the rehydrated window clean", async () => {
    const { driver } = memoryDriver();
    const cfg = { mode: "paged" as const, total: true, pagination: { persistPendingAdds: "drop" } };
    const s = makeStore(cfg);
    await s.store.persist.enable({ key: "k", driver, debounce: 0 });
    await load(s);
    s.list().add({ id: "tmp1", name: "Draft" });
    await s.store.persist.flush();

    const s2 = makeStore(cfg);
    await s2.store.persist.enable({ key: "k", driver, debounce: 0 });
    await flushPromises();
    expect(s2.list().pendingAdds).toEqual([]);
    expect(s2.list().dirty).toBe(false);
  });

  it("J4. a quota failure surfaces, retries smaller, and never kills the form's persistence", async () => {
    const mem = new Map<string, string>();
    let failLarge = true;
    const quota = Object.assign(new Error("quota"), { name: "QuotaExceededError" });
    const driver = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (failLarge && v.includes('"ids"')) throw quota;
        mem.set(k, v);
      },
      removeItem: (k: string) => void mem.delete(k),
    };
    const onError = vi.fn();
    const s = makeStore({ mode: "paged", total: true });
    await s.store.persist.enable({ key: "k", driver, debounce: 0, onError });
    await load(s);
    (s.store.proxy as any).search.value = "typed";
    await s.store.persist.flush();
    // The pagination blob was trimmed to its pointer; the form's own field made it.
    expect(onError).not.toHaveBeenCalled();
    const saved = JSON.parse(mem.get("k")!);
    expect(saved.search).toBe("typed");
    expect(saved.__pagination).toBeUndefined();

    failLarge = false;
    const dead = { ...driver, setItem: () => { throw quota; } };
    const s2 = makeStore({ mode: "paged", total: true });
    const onError2 = vi.fn();
    await s2.store.persist.enable({ key: "k2", driver: dead, onError: onError2, debounce: 0 });
    await load(s2);
    await s2.store.persist.flush();
    expect(onError2).toHaveBeenCalledWith(quota, "save");

    // A corrupt snapshot reports rather than silently hydrating nothing.
    const onError3 = vi.fn();
    mem.set("bad", "{not json");
    const s3 = makeStore({ mode: "paged" });
    await s3.store.persist.enable({ key: "bad", driver, onError: onError3, debounce: 0 });
    expect(onError3).toHaveBeenCalledTimes(1);
    expect(onError3.mock.calls[0][1]).toBe("hydrate");
  });

  it("J5. revalidateOnHydrate: 'first' serves the stale window and refreshes one ordinal", async () => {
    const { driver } = memoryDriver();
    const cfg = {
      total: true,
      pagination: { staleTime: 1, persist: "window" as const },
    };
    const s = makeStore(cfg);
    await s.store.persist.enable({ key: "k", driver, debounce: 0 });
    await load(s);
    s.list().loadMore();
    await flushPromises();
    await s.store.persist.flush();
    await new Promise((r) => setTimeout(r, 5));

    const s2 = makeStore(cfg);
    await s2.store.persist.enable({ key: "k", driver, debounce: 0 });
    expect(s2.ids().length).toBe(40); // stale, but SERVED
    expect(s2.list().isStaleFromStorage).toBe(true);
    expect(s2.list().isInitialLoading).toBe(false);
    await flushPromises();
    await flushPromises();
    expect(s2.resolver).toHaveBeenCalledTimes(1);
    expect(s2.calls[0]).toMatchObject({ page: 1 });
    expect(s2.ids().length).toBe(40);
  });

  it("J6. a stale hydrated cursor rebuilds the chain; an unusable one is reported", async () => {
    const { driver } = memoryDriver();
    const cfg = { mode: "cursor" as const, cursors: true, pagination: { persist: "window" as const } };
    const s = makeStore(cfg);
    await s.store.persist.enable({ key: "k", driver, debounce: 0 });
    await load(s);
    await s.store.persist.flush();

    // The restored cursor "20@1" is rejected; the rebuild re-fetches ordinal 1
    // (a live chain head) and continues off its fresh "20@2".
    const s2 = makeStore({ ...cfg, cursorEpoch: 2, rejectCursors: new Set(["20@1"]) });
    await s2.store.persist.enable({ key: "k", driver, debounce: 0 });
    await flushPromises();
    expect(s2.ids().length).toBe(20);
    expect(s2.resolver).toHaveBeenCalledTimes(0);

    s2.list().nextPage();
    await flushPromises();
    await flushPromises();
    await flushPromises();
    expect(s2.list().error).toBe(null);
    expect(s2.list().continuationLost).toBe(false);
    expect(s2.list().page).toBe(2);
    expect(s2.ids()).toEqual(ALL.slice(20, 40).map((u) => u.id));

    // A chain that cannot be rebuilt at all is reported, not retried forever.
    const s3 = makeStore({ ...cfg, rejectAllCursors: true });
    await s3.store.persist.enable({ key: "k", driver, debounce: 0 });
    await flushPromises();
    s3.list().nextPage();
    await flushPromises();
    await flushPromises();
    await flushPromises();
    expect(s3.list().continuationLost).toBe(true);
    expect(s3.list().hasNextPage).toBe(false);
  });

  it("J8. persist: false writes no blob; the restored array bootstraps and reconciles", async () => {
    const { driver, mem } = memoryDriver();
    const cfg = { mode: "paged" as const, total: true, pagination: { persist: false } };
    const s = makeStore(cfg);
    await s.store.persist.enable({ key: "k", driver, debounce: 0 });
    await load(s);
    await s.store.persist.flush();
    const raw = JSON.parse(mem.get("k")!);
    expect(raw.__pagination).toBeUndefined();
    expect(Array.isArray(raw.users)).toBe(true);

    const s2 = makeStore(cfg);
    await s2.store.persist.enable({ key: "k", driver, debounce: 0 });
    await flushPromises();
    expect(s2.ids().length).toBe(20); // the draft is served meanwhile
    expect(s2.list().resolveStatus).toBe("idle");
    void s2.list().items;
    await flushPromises();
    expect(s2.resolver).toHaveBeenCalledTimes(1); // one reconciling fetch
  });

  it("J9. revalidateOnHydrate: 'all' refreshes every restored ordinal, 'none' refreshes nothing", async () => {
    const save = async (driver: any) => {
      const s = makeStore({ total: true, pagination: { staleTime: 1, persist: "window" } });
      await s.store.persist.enable({ key: "k", driver, debounce: 0 });
      await load(s);
      s.list().loadMore();
      await flushPromises();
      await s.store.persist.flush();
      await new Promise((r) => setTimeout(r, 5));
    };

    const a = memoryDriver();
    await save(a.driver);
    const all = makeStore({
      total: true,
      pagination: { staleTime: 1, persist: "window", revalidateOnHydrate: "all" },
    });
    await all.store.persist.enable({ key: "k", driver: a.driver, debounce: 0 });
    await flushPromises();
    await flushPromises();
    expect(all.calls.map((c) => c.page).sort()).toEqual([1, 2]);
    expect(all.ids().length).toBe(40);

    const b = memoryDriver();
    await save(b.driver);
    const none = makeStore({
      total: true,
      pagination: { staleTime: 1, persist: "window", revalidateOnHydrate: "none" },
    });
    await none.store.persist.enable({ key: "k", driver: b.driver, debounce: 0 });
    await flushPromises();
    await flushPromises();
    expect(none.resolver).toHaveBeenCalledTimes(0);
    expect(none.ids().length).toBe(40);
  });

  it("J7. an account switch clears the families — no cross-key completion survives", async () => {
    const { driver } = memoryDriver();
    const s = makeStore({ mode: "paged", total: true });
    await s.store.persist.enable({ key: "a", driver, debounce: 0 });
    await load(s);
    expect(s.ids().length).toBe(20);

    await s.store.persist.enable({ key: "b", driver, debounce: 0 });
    await flushPromises();
    expect(s.ls().pagination!.families.size).toBe(0);
    expect(s.ids().length).toBe(0);
    void s.list().items;
    await flushPromises();
    expect(s.resolver).toHaveBeenCalledTimes(2); // refetched under the new session
    expect(s.ids().length).toBe(20);
  });
});
