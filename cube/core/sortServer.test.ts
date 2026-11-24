/**
 * The server sort, Stage 2 of experiments/SortPlan.md (Cube only): a list
 * that does not hold all its rows (paginated, or `$server: true`) sends its
 * sort to the resolver as `ctx.sort`, and the sort is part of the request
 * identity — a plain list runs again, a paginated one changes its query key
 * through the `$sort` pseudo-dependency. `initialData` answers `$default`;
 * a persisted window answers the sort it was saved under.
 */
import { describe, it, expect, vi } from "vitest";
import {
  Palistor,
  defineList,
  type FilterBlock,
  type ListResolveContext,
  type PageRequest,
  type PaginationConfig,
  type SortBlock,
  type SortRequest,
} from "../index";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

type Order = { id: string; title: string; amount: number; createdAt: string; status: string };

/** 45 orders: created in id order, distinct amounts, every third one closed. */
const ORDERS: Order[] = Array.from({ length: 45 }, (_, i) => ({
  id: `o${i + 1}`,
  title: `Order ${String.fromCharCode(65 + ((i * 7) % 26))}${i + 1}`,
  amount: (i * 37) % 100,
  createdAt: `2026-01-01T00:${String(i).padStart(2, "0")}:00Z`,
  status: i % 3 ? "open" : "closed",
}));

const template = {
  id: { value: "" }, title: { value: "" }, amount: { value: 0 }, createdAt: { value: "" }, status: { value: "" },
};

/** The server's columns by the param the resolver receives. */
const COLUMN: Record<string, keyof Order> = { created_at: "createdAt", createdAt: "createdAt", title: "title", amount: "amount" };

/** What the server answers: filtered by `status`, sorted by ctx.sort.by. */
function serve(params: unknown, by: SortRequest["by"]): Order[] {
  const status = (params as { status?: string } | undefined)?.status;
  const rows = status ? ORDERS.filter((o) => o.status === status) : ORDERS;
  if (by.length === 0) return rows;
  return [...rows].sort((a, b) => {
    for (const s of by) {
      const f = COLUMN[s.param];
      const c = a[f] < b[f] ? -1 : a[f] > b[f] ? 1 : 0;
      if (c) return s.dir === "asc" ? c : -c;
    }
    return 0;
  });
}

const idsOf = (rows: Order[]) => rows.map((o) => o.id);

interface Call { sort: SortRequest; status: unknown; page?: PageRequest; queryKey: string }

interface Opts {
  sort: SortBlock<Order>;
  filter?: FilterBlock<Order>;
  /** false: a plain list (the sort block then needs `$server: true`). */
  pagination?: Partial<PaginationConfig> | false;
  /** Every run parks until the test releases it. */
  hold?: boolean;
  initialData?: unknown;
}

function orders(opts: Opts) {
  const calls: Call[] = [];
  const parked: Array<() => void> = [];
  const resolver = vi.fn(async (_values: unknown, _store: unknown, ctx: ListResolveContext) => {
    calls.push({ sort: ctx.sort, status: (ctx.filter.params as { status?: unknown } | undefined)?.status, page: ctx.page, queryKey: ctx.queryKey });
    const rows = serve(ctx.filter.params, ctx.sort.by);
    if (opts.hold) await new Promise<void>((r) => parked.push(r));
    if (!ctx.page) return rows;
    return { items: rows.slice(ctx.page.offset, ctx.page.offset + ctx.page.pageSize), total: rows.length };
  });
  const resolve = opts.pagination === false
    ? { resolver }
    : { resolver, pagination: { pageSize: 20, ...opts.pagination } as PaginationConfig };
  const store = new Palistor({
    config: { orders: defineList<Order>({ template, sort: opts.sort, ...(opts.filter ? { filter: opts.filter } : {}), resolve }) },
    ...(opts.initialData === undefined ? {} : { initialData: opts.initialData as never }),
  });
  const list = store.proxy.orders;
  const ids = () => (list.items as unknown as Array<{ id: string }>).map((row) => row.id);
  /** Releases every parked run and lets it land. */
  const release = async () => { for (const r of parked.splice(0)) r(); await flush(); await flush(); };
  const batch = (fn: () => void) => (store as unknown as { hub: { batch(fn: () => void): void } }).hub.batch(fn);
  return { store, list, sort: list.sort!, ids, calls, resolver, release, batch };
}

const load = async (list: { items: unknown }) => { void list.items; await flush(); };

const DEFAULT: SortBlock<Order> = { $default: "-createdAt", title: true, amount: true, createdAt: { param: "created_at" } };

// ─── ctx.sort (decision 11) ──────────────────────────────────────────────────

describe("ctx.sort", () => {
  it("carries { key, param, dir } per entry and a key; param defaults to the key", async () => {
    const { list, sort, calls } = orders({ sort: DEFAULT });
    await load(list);
    expect(calls[0].sort).toEqual({ by: [{ key: "createdAt", param: "created_at", dir: "desc" }], key: '[["created_at","desc"]]' });
    sort.toggle("title");
    await flush();
    expect(calls[1].sort).toEqual({ by: [{ key: "title", param: "title", dir: "asc" }], key: '[["title","asc"]]' });
  });

  it("without a server sort: ctx.sort is empty and the query key is what a list without a sort block gets", async () => {
    const sorted = orders({ sort: { title: true }, filter: { status: "" } });
    const plain = orders({ sort: undefined as unknown as SortBlock<Order>, filter: { status: "" } });
    await load(sorted.list);
    await load(plain.list);
    expect(sorted.calls[0].sort).toEqual({ by: [], key: "" });
    expect(sorted.calls[0].queryKey).toBe(plain.calls[0].queryKey);

    sorted.sort.toggle("title");
    await flush();
    expect(sorted.calls[1].queryKey).not.toBe(plain.calls[0].queryKey);
    sorted.sort.clear();
    await flush();
    expect(sorted.calls[2].queryKey).toBe(plain.calls[0].queryKey);
  });

  it("a plain list with $server: true: the same ctx.sort; queryKey is the filter key without a sort, both keys with one", async () => {
    const { list, sort, calls } = orders({ sort: { $server: true, $default: "amount", amount: true }, filter: { status: "" }, pagination: false });
    await load(list);
    expect(calls[0].sort).toEqual({ by: [{ key: "amount", param: "amount", dir: "asc" }], key: '[["amount","asc"]]' });
    expect(calls[0].queryKey).toBe('{"filter":"{\\"status\\":\\"\\"}","sort":"[[\\"amount\\",\\"asc\\"]]"}');
    sort.clear();
    await flush();
    expect(calls[1].sort).toEqual({ by: [], key: "" });
    expect(calls[1].queryKey).toBe('{"status":""}'); // what a list without a server sort always had
  });
});

// ─── A plain list with $server: true ─────────────────────────────────────────

describe("$server: true on a plain list", () => {
  const block: SortBlock<Order> = { $server: true, title: true, amount: true };

  it("a toggle is exactly one request; the list shows the rows in the server's order", async () => {
    const { list, sort, calls, ids } = orders({ sort: block, pagination: false });
    await load(list);
    expect(calls).toHaveLength(1);
    expect(ids()).toEqual(idsOf(ORDERS));

    sort.toggle("amount");
    await flush();
    expect(calls).toHaveLength(2);
    expect(ids()).toEqual(idsOf(serve(undefined, [{ key: "amount", param: "amount", dir: "asc" }])));
    expect(list.getValues().map((o) => o.id)).toEqual(ids()); // the server's order is the membership
  });

  it("five presses while a request is in flight: one re-run, with the latest state", async () => {
    const { list, sort, calls, release } = orders({ sort: block, pagination: false, hold: true });
    void list.items;
    await flush();
    await release();
    sort.toggle("title"); // run 2, parked
    await flush();
    expect(calls).toHaveLength(2);
    for (let i = 0; i < 5; i++) sort.toggle("amount"); // asc, desc, none, asc, desc
    await flush();
    expect(calls).toHaveLength(2);
    expect(sort.by).toEqual([{ key: "amount", dir: "desc" }]);

    await release(); // run 2 lands: one re-run with the last state
    expect(calls).toHaveLength(3);
    expect(calls[2].sort.by).toEqual([{ key: "amount", param: "amount", dir: "desc" }]);
    await release();
    expect(calls).toHaveLength(3);
  });

  it("a list that has not run yet requests nothing for a sort change, and reads the sort on its first run", async () => {
    const { list, sort, calls } = orders({ sort: block, pagination: false });
    sort.set("title", "desc");
    await flush();
    expect(calls).toHaveLength(0);
    await load(list);
    expect(calls).toHaveLength(1);
    expect(calls[0].sort.by).toEqual([{ key: "title", param: "title", dir: "desc" }]);
  });

  it("initialData answers $default: no request after construction; a sort change is one", async () => {
    const first = serve(undefined, [{ key: "amount", param: "amount", dir: "desc" }]).slice(0, 10);
    const { list, sort, calls, ids } = orders({ sort: { ...block, $default: "-amount" }, pagination: false, initialData: { orders: first } });
    expect(ids()).toEqual(idsOf(first));
    expect(list.resolveStatus).toBe("resolved");
    await flush();
    expect(calls).toHaveLength(0);
    sort.toggle("title");
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0].sort.by).toEqual([{ key: "title", param: "title", dir: "asc" }]);
  });
});

// ─── Pagination: the $sort pseudo-dependency ─────────────────────────────────

describe("a paginated list", () => {
  it("that has not fetched yet requests nothing for a sort change, and keys its first page on the sort", async () => {
    const { list, sort, calls } = orders({ sort: DEFAULT });
    sort.set("amount", "desc");
    await flush();
    expect(calls).toHaveLength(0);
    await load(list);
    expect(calls).toHaveLength(1);
    expect(calls[0].sort.key).toBe('[["amount","desc"]]');
    expect(calls[0].queryKey).toBe('[["$sort","[[\\"amount\\",\\"desc\\"]]"]]');
  });

  it("a sort change goes back to the first page with one request", async () => {
    const { list, sort, calls, ids } = orders({ sort: DEFAULT });
    await load(list);
    list.setPage!(3);
    await flush();
    expect(list.page).toBe(3);
    expect(calls).toHaveLength(2);

    sort.toggle("amount");
    await flush();
    expect(calls).toHaveLength(3);
    expect(calls[2].page).toMatchObject({ page: 1, offset: 0 });
    expect(list.page).toBe(1);
    expect(ids()).toEqual(idsOf(serve(undefined, [{ key: "amount", param: "amount", dir: "asc" }]).slice(0, 20)));
    expect(list.total).toBe(45);
  });

  it("back to a previous sort with maxCachedQueries: 2 is served from the cache", async () => {
    const { list, sort, calls, ids } = orders({ sort: DEFAULT, pagination: { maxCachedQueries: 2 } });
    await load(list);
    const first = ids();
    sort.set("title");
    await flush();
    expect(calls).toHaveLength(2);
    sort.reset(); // back to -createdAt
    await flush();
    expect(calls).toHaveLength(2);
    expect(ids()).toEqual(first);
    sort.set("title"); // and the other way
    await flush();
    expect(calls).toHaveLength(2);
    sort.set("amount"); // a third key: a request (and the oldest family goes)
    await flush();
    expect(calls).toHaveLength(3);
  });

  it("keepPreviousData keeps the rows on screen and sets isPreviousData until the new first page lands", async () => {
    const { list, sort, calls, ids, release } = orders({ sort: DEFAULT, pagination: { keepPreviousData: true }, hold: true });
    void list.items;
    await flush();
    await release();
    const before = ids();
    sort.toggle("amount");
    await flush();
    expect(calls).toHaveLength(2);
    expect(ids()).toEqual(before);
    expect(list.isPreviousData).toBe(true);
    await release();
    expect(list.isPreviousData).toBe(false);
    expect(ids()).toEqual(idsOf(serve(undefined, [{ key: "amount", param: "amount", dir: "asc" }]).slice(0, 20)));
  });

  it("infinite: the window resets to the first page", async () => {
    const { list, sort, calls, ids } = orders({ sort: DEFAULT, pagination: { mode: "infinite" } });
    await load(list);
    list.loadMore!();
    await flush();
    list.loadMore!();
    await flush();
    expect(ids()).toHaveLength(45);
    expect(calls).toHaveLength(3);

    sort.toggle("title");
    await flush();
    expect(calls).toHaveLength(4);
    expect(calls[3].page).toMatchObject({ page: 1, offset: 0 });
    expect(ids()).toEqual(idsOf(serve(undefined, [{ key: "title", param: "title", dir: "asc" }]).slice(0, 20)));
    expect(list.loadedPages!.map((p) => p.ordinal)).toEqual([1]);
  });
});

// ─── With the filter ─────────────────────────────────────────────────────────

describe("a sort and a server filter changed in one batch", () => {
  const kinds = [
    ["paginated", { sort: DEFAULT }],
    ["plain, $server: true", { sort: { ...DEFAULT, $server: true }, pagination: false as const }],
  ] as const;

  for (const [kind, base] of kinds) {
    it(`${kind}: an automatic field — one request, in either order`, async () => {
      const { list, sort, calls, batch } = orders({ ...base, filter: { status: "" } });
      await load(list);
      batch(() => { list.filter!.status.value = "open"; sort.toggle("amount"); });
      await flush();
      batch(() => { sort.toggle("amount"); list.filter!.status.value = "closed"; });
      await flush();
      expect(calls.map((c) => [c.status, c.sort.key])).toEqual([
        ["", '[["created_at","desc"]]'],
        ["open", '[["amount","asc"]]'],
        ["closed", '[["amount","desc"]]'],
      ]);
    });

    it(`${kind}: filter.apply() of a manual field — one request, in either order`, async () => {
      const { list, sort, calls, batch } = orders({ ...base, filter: { $apply: "manual", status: "" } });
      await load(list);
      const filter = list.filter!;
      filter.status.value = "open"; // a draft: no request
      await flush();
      expect(calls).toHaveLength(1);
      batch(() => { filter.apply(); sort.toggle("amount"); });
      await flush();
      filter.status.value = "closed";
      batch(() => { sort.toggle("amount"); filter.apply(); });
      await flush();
      expect(calls.map((c) => [c.status, c.sort.key])).toEqual([
        ["", '[["created_at","desc"]]'],
        ["open", '[["amount","asc"]]'],
        ["closed", '[["amount","desc"]]'],
      ]);
    });
  }

  it("a sort change during the filter's debounce carries the debounced value: one request, none when the debounce runs out", async () => {
    const { list, sort, calls } = orders({ sort: DEFAULT, filter: { status: { value: "", debounce: 30 } } });
    await load(list);
    list.filter!.status.value = "open";
    expect(list.filter!.isPending).toBe(true);
    sort.toggle("amount");
    await flush();
    expect(calls.map((c) => [c.status, c.sort.key])).toEqual([
      ["", '[["created_at","desc"]]'],
      ["open", '[["amount","asc"]]'],
    ]);
    await new Promise<void>((r) => setTimeout(r, 50));
    await flush();
    expect(calls).toHaveLength(2);
    expect(list.filter!.isPending).toBe(false);
  });
});

// ─── initialData (paginated) and persisted windows ──────────────────────────

describe("initialData on a paginated list", () => {
  it("answers $default: no request after construction; a sort change is one request for the first page", async () => {
    const first = serve(undefined, [{ key: "createdAt", param: "created_at", dir: "desc" }]).slice(0, 20);
    const { list, sort, calls, ids } = orders({ sort: DEFAULT, initialData: { orders: { items: first, total: 45 } } });
    expect(ids()).toEqual(idsOf(first));
    await flush();
    expect(calls).toHaveLength(0);
    sort.toggle("title");
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0].page).toMatchObject({ page: 1 });
    expect(calls[0].sort.key).toBe('[["title","asc"]]');
  });
});

describe("a persisted window (persist: \"window\")", () => {
  function memoryDriver() {
    const mem = new Map<string, string>();
    return {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    };
  }

  it("saved under $default is served on the next visit without a request", async () => {
    const driver = memoryDriver();
    const a = orders({ sort: DEFAULT, pagination: { persist: "window" } });
    await a.store.persist.enable({ key: "k", driver, debounce: 0 });
    await load(a.list);
    await a.store.persist.flush();

    const b = orders({ sort: DEFAULT, pagination: { persist: "window" } });
    await b.store.persist.enable({ key: "k", driver, debounce: 0 });
    await load(b.list);
    expect(b.calls).toHaveLength(0);
    expect(b.ids()).toEqual(a.ids());
  });

  it("saved under another sort is not served: the sort is not persisted, the next visit starts at $default and fetches it", async () => {
    const driver = memoryDriver();
    const a = orders({ sort: DEFAULT, pagination: { persist: "window" } });
    await a.store.persist.enable({ key: "k", driver, debounce: 0 });
    await load(a.list);
    a.sort.set("amount");
    await flush();
    await a.store.persist.flush();

    const b = orders({ sort: DEFAULT, pagination: { persist: "window" } });
    await b.store.persist.enable({ key: "k", driver, debounce: 0 });
    expect(b.sort.by).toEqual([{ key: "createdAt", dir: "desc" }]);
    await load(b.list);
    expect(b.calls).toHaveLength(1);
    expect(b.calls[0].sort.key).toBe('[["created_at","desc"]]');
    expect(b.ids()).toEqual(idsOf(serve(undefined, [{ key: "createdAt", param: "created_at", dir: "desc" }]).slice(0, 20)));
  });
});

// ─── Construction (decision 3, server class) ─────────────────────────────────

describe("a server sort's block", () => {
  it("takes true and { param }; { by } / { compare } throw (the client order can never apply)", () => {
    expect(() => orders({ sort: { title: { param: "t" } } })).not.toThrow();
    expect(() => orders({ sort: { title: { by: (row) => row.title } } })).toThrow('declares "by", but the server sorts this list (resolve.pagination)');
    expect(() => orders({ sort: { $server: true, amount: { compare: (a, b) => a.amount - b.amount } }, pagination: false })).toThrow(
      'declares "compare", but the server sorts this list ($server: true)',
    );
  });

  it("a server sort never reorders the loaded rows itself", async () => {
    const { list, sort, ids, release } = orders({ sort: DEFAULT, pagination: { keepPreviousData: true }, hold: true });
    void list.items;
    await flush();
    await release();
    const before = ids();
    sort.toggle("amount"); // the request is parked: the rows stay as the server sent them
    expect(ids()).toEqual(before);
    sort.refresh();
    expect(ids()).toEqual(before);
    await release();
  });
});
