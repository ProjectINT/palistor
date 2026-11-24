/**
 * Pagination behavior that differs from store on purpose (cube project only).
 * Shared behavior is in cube/contract/sliceG.
 */
import { describe, it, expect, vi } from "vitest";
import { Palistor } from "../palistor";
import { defineList } from "../defineList";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

type User = { id: string; name: string };
const ALL: User[] = Array.from({ length: 45 }, (_, i) => ({ id: `u${i + 1}`, name: `User ${i + 1}` }));
const template = { id: { value: "" }, name: { value: "" } };

function slice(rows: User[], offset: number, size: number) {
  return { items: rows.slice(offset, offset + size), total: rows.length };
}

describe("re-keys caused by the user", () => {
  // store: every re-key of a paginated list counts against MAX_AUTO_RETRIGGERS
  // (10), and only a page visit or setContext resets the counter. A list keyed
  // on a form field stops following it after the tenth change: 15 changes, 11
  // resolver calls, the rows of "User 10" under a search of "User 15".
  it("a form field the resolver reads re-keys the list on every change", async () => {
    const resolver = vi.fn(async (values: any, _s: unknown, ctx: any) => {
      const q = String(values.search ?? "");
      return slice(q ? ALL.filter((u) => u.name.includes(q)) : ALL, ctx.page.offset, ctx.page.pageSize);
    });
    const store = new Palistor({
      config: {
        search: { value: "" },
        users: defineList({ template, resolve: { resolver, pagination: { pageSize: 20 } } }) as any,
      },
    });
    const p = store.proxy as any;
    void p.users.items;
    await flush();
    for (let i = 1; i <= 15; i++) {
      p.search.value = `User ${i}`;
      await flush();
    }
    expect(resolver).toHaveBeenCalledTimes(16);
    expect(resolver.mock.calls[15][0].search).toBe("User 15");
    expect(p.users.items.map((u: any) => u.id)).toEqual(["u15"]);
  });

  it("a resolver that writes the value it reads still stops at the cap", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let n = 0;
    const store = new Palistor({
      config: {
        counter: { value: 0 },
        users: defineList({
          template,
          resolve: {
            resolver: async (values: any, s: any) => {
              void values.counter;
              n++;
              queueMicrotask(() => { s.proxy.counter.value = n; });
              return { items: ALL.slice(0, 5), total: 5 };
            },
            pagination: { pageSize: 5 },
          },
        }) as any,
      },
    });
    void (store.proxy as any).users.items;
    for (let i = 0; i < 40; i++) await flush();
    expect(n).toBe(11);
    // A user action lifts the stop.
    (store.proxy as any).users.refetch();
    for (let i = 0; i < 40; i++) await flush();
    expect(n).toBe(22);
    warn.mockRestore();
  });
});

describe("a server filter flipping back to a retained query", () => {
  // store (and cube before 2.5): the filter gate compared the server key with
  // the one of the last LAUNCH. A flip back to a retained family is served
  // from cache without a launch, so a→""→a looked like "no change": the list
  // stayed on the unfiltered rows while the filter said "a".
  it("a → '' → a follows the filter, served from the retained families", async () => {
    const calls: unknown[] = [];
    const store = new Palistor({
      config: {
        users: defineList({
          template,
          filter: { q: "" },
          resolve: {
            resolver: async (_v: unknown, _s: unknown, ctx: any) => {
              const q = ctx.filter.values.q as string;
              calls.push(q);
              return slice(q ? ALL.filter((u) => u.name.includes(q)) : ALL, ctx.page.offset, ctx.page.pageSize);
            },
            pagination: { pageSize: 20, maxCachedQueries: 2 },
          },
        }) as any,
      },
    });
    const list = (store.proxy as any).users;
    void list.items;
    await flush();
    list.filter.q.value = "User 4";
    await flush();
    expect(list.total).toBe(7);
    list.filter.q.value = "";
    await flush();
    expect(list.total).toBe(45);
    list.filter.q.value = "User 4";
    await flush();
    expect(list.total).toBe(7);
    expect(list.items.length).toBe(7);
    expect(calls).toEqual(["", "User 4"]);
  });
});

describe("nextCursor: null ends the feed (cursor and infinite)", () => {
  // store (and cube before Stage 5а): a recorded `null` cursor counted as "there is a next page" in
  // cursor mode, and a full last page in infinite mode fell through to the full-page heuristic, so
  // loadMore() went out with `cursor: null` and the feed started over.
  const ROWS: User[] = ALL.slice(0, 30);

  /** 10 rows per page off a cursor ("c10", "c20"); `last` shapes what the final page carries next to its rows. */
  function feed(mode: "infinite" | "cursor", last: Record<string, unknown>, initialData?: unknown) {
    const resolver = vi.fn(async (_v: unknown, _s: unknown, ctx: any) => {
      const offset = ctx.page.cursor ? Number(String(ctx.page.cursor).slice(1)) : 0;
      const items = ROWS.slice(offset, offset + 10);
      const end = offset + 10 >= ROWS.length;
      return end ? { items, ...last } : { items, nextCursor: `c${offset + 10}` };
    });
    const store = new Palistor({
      config: {
        users: defineList({ template, resolve: { resolver, onError: vi.fn(), pagination: { pageSize: 10, mode } } }) as any,
      },
      ...(initialData ? { initialData: { users: initialData } } : {}),
    });
    return { list: (store.proxy as any).users, resolver };
  }

  it("infinite: a full last page with nextCursor: null reads hasNextPage: false, and loadMore() requests nothing", async () => {
    const { list, resolver } = feed("infinite", { nextCursor: null });
    void list.items;
    await flush();
    expect(list.hasNextPage).toBe(true);
    list.loadMore();
    await flush();
    list.loadMore();
    await flush();
    expect(list.length).toBe(30);
    expect(resolver).toHaveBeenCalledTimes(3);
    expect(list.hasNextPage).toBe(false); // the last page is full: the page-size heuristic alone would say true

    list.loadMore();
    await flush();
    expect(resolver).toHaveBeenCalledTimes(3);
    expect(list.length).toBe(30);
  });

  it("infinite: null wins over a total and a hasMore that say there is more", async () => {
    const { list, resolver } = feed("infinite", { nextCursor: null, total: 500, hasMore: true });
    void list.items;
    await flush();
    list.loadMore();
    await flush();
    list.loadMore();
    await flush();
    expect(list.hasNextPage).toBe(false);
    list.loadMore();
    await flush();
    expect(resolver).toHaveBeenCalledTimes(3);
  });

  it("infinite: a last page without the field keeps the previous rule (hasMore, then a full page)", async () => {
    const byHasMore = feed("infinite", { hasMore: false });
    void byHasMore.list.items;
    await flush();
    byHasMore.list.loadMore();
    await flush();
    byHasMore.list.loadMore();
    await flush();
    expect(byHasMore.list.hasNextPage).toBe(false);

    const bySize = feed("infinite", {});
    void bySize.list.items;
    await flush();
    bySize.list.loadMore();
    await flush();
    bySize.list.loadMore();
    await flush();
    expect(bySize.list.hasNextPage).toBe(true); // a full page and nothing else to go by
  });

  it("cursor: the page that came with nextCursor: null has no next one; nextPage, setPage and prefetch request nothing", async () => {
    const { list, resolver } = feed("cursor", { nextCursor: null });
    void list.items;
    await flush();
    expect(list.hasNextPage).toBe(true);
    list.nextPage();
    await flush();
    list.nextPage();
    await flush();
    expect(list.page).toBe(3);
    expect(list.items.map((u: any) => u.id)).toEqual(ROWS.slice(20).map((u) => u.id));
    expect(resolver).toHaveBeenCalledTimes(3);
    expect(list.hasNextPage).toBe(false);

    list.nextPage();
    list.setPage(4);
    await list.prefetch(4);
    await flush();
    expect(resolver).toHaveBeenCalledTimes(3);
    expect(list.page).toBe(3);

    list.prevPage(); // cached: its own cursor still leads on
    expect(list.page).toBe(2);
    expect(list.hasNextPage).toBe(true);
    expect(resolver).toHaveBeenCalledTimes(3);
  });

  it("cursor: a last page without the field keeps the previous rule", async () => {
    const { list } = feed("cursor", { hasMore: false });
    void list.items;
    await flush();
    list.nextPage();
    await flush();
    list.nextPage();
    await flush();
    expect(list.page).toBe(3);
    expect(list.hasNextPage).toBe(false);

    const bySize = feed("cursor", {});
    void bySize.list.items;
    await flush();
    bySize.list.nextPage();
    await flush();
    bySize.list.nextPage();
    await flush();
    expect(bySize.list.hasNextPage).toBe(true);
  });

  it("cursor: a page answered again without the field goes back to the previous rule, not to its old null", async () => {
    let answer: Record<string, unknown> = { nextCursor: null };
    const resolver = vi.fn(async () => ({ items: ROWS.slice(0, 10), ...answer }));
    const store = new Palistor({
      config: {
        users: defineList({ template, resolve: { resolver, onError: vi.fn(), pagination: { pageSize: 10, mode: "cursor" } } }) as any,
      },
    });
    const list = (store.proxy as any).users;
    void list.items;
    await flush();
    expect(list.hasNextPage).toBe(false);

    answer = { hasMore: false };
    await list.refetch();
    expect(list.hasNextPage).toBe(false); // hasMore decides; the null recorded by the first answer does not say "there is a next page"

    answer = {};
    await list.refetch();
    expect(list.hasNextPage).toBe(true); // a full page and nothing else to go by
  });

  it("a first page given as initialData with nextCursor: null is a complete feed", async () => {
    for (const mode of ["infinite", "cursor"] as const) {
      const { list, resolver } = feed(mode, {}, { items: ROWS.slice(0, 10), nextCursor: null });
      expect(list.length).toBe(10);
      expect(list.hasNextPage).toBe(false);
      if (mode === "infinite") list.loadMore();
      else list.nextPage();
      await flush();
      expect(resolver).not.toHaveBeenCalled();
    }
  });
});

describe("a window page that is not cached yet is not an invariant violation", () => {
  // store (and cube before Stage 5а) logged "[palistor] pagination invariant: window ordinal N of
  // list … has no cached page" on every query-key change: the new key's family is projected empty
  // right before its first page is requested.
  function usersStore(fail: { now: boolean } = { now: false }) {
    const resolver = vi.fn(async (values: any, _s: unknown, ctx: any) => {
      if (fail.now) throw new Error("load failed");
      const q = String(ctx.filter.values.q ?? "") + String(values.search ?? "");
      return slice(q ? ALL.filter((u) => u.name.includes(q)) : ALL, ctx.page.offset, ctx.page.pageSize);
    });
    const store = new Palistor({
      config: {
        search: { value: "" },
        users: defineList({
          template,
          filter: { q: "" },
          resolve: { resolver, onError: vi.fn(), deps: ["search"], pagination: { pageSize: 20 } },
        }) as any,
      },
    });
    return { store, p: store.proxy as any, list: (store.proxy as any).users, resolver };
  }
  const invariant = (warn: ReturnType<typeof vi.spyOn>) =>
    warn.mock.calls.map((c: unknown[]) => String(c[0])).filter((m: string) => m.includes("pagination invariant"));

  it("a server filter change and a deps change do not warn, from page 1 or from page 2", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { p, list, resolver } = usersStore();
      void list.items;
      await flush();
      list.filter.q.value = "User 4"; // from page 1
      await flush();
      expect(list.total).toBe(7);

      list.filter.q.value = "";
      await flush();
      list.setPage(2);
      await flush();
      expect(list.page).toBe(2);
      list.filter.q.value = "User 1"; // from page 2
      await flush();
      expect(list.page).toBe(1);

      p.search.value = "0"; // a declared dep
      await flush();
      expect(list.items.map((u: any) => u.id)).toEqual(["u10"]);

      expect(resolver).toHaveBeenCalledTimes(6);
      expect(invariant(warn)).toEqual([]);
    } finally { warn.mockRestore(); }
  });

  it("a first page that failed to load is not reported either (reset, a local edit)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const fail = { now: true };
      const { store, list } = usersStore(fail);
      void list.items;
      await flush();
      expect(list.resolveStatus).toBe("error");
      store.reset();
      store.delete("u1");
      expect(invariant(warn)).toEqual([]);
    } finally { warn.mockRestore(); }
  });

  it("the diagnostic stays for a window the pager holds for loaded", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { store, list } = usersStore();
      void list.items;
      await flush();
      list.setPage(2); // in flight
      store.reset();   // drops the in-flight result: page 2 never lands, nothing is fetching it
      await flush();
      expect(list.resolveStatus).toBe("resolved");
      expect(invariant(warn)).toEqual([]); // while the page was in flight: nothing to report
      store.delete("u1"); // re-projects the window
      expect(invariant(warn)).toEqual([expect.stringContaining('window ordinal 2 of list "users" has no cached page')]);
    } finally { warn.mockRestore(); }
  });
});
