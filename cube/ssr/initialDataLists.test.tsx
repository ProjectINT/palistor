/**
 * `initialData` for lists (experiments/SsrPlan.md, Stage 3), Cube only.
 *
 *  A. Nested lists: a row carries the rows of its per-entity lists. They get
 *     their membership and baseline, and start resolved; a row that carried
 *     none resolves its list on the first read.
 *  B. A paginated list takes its first page — an array, or what a paginated
 *     resolver returns (`{ items, total?, nextCursor?, hasMore? }`). The page
 *     is filed as a fetched one: fresh, with its total and cursor. The next
 *     page is fetched as usual, the way back is served from the cache.
 *  C. A server filter: the data answers the filter's current values, so
 *     nothing is requested after construction; a change is one request.
 *  D. The first page under server render and hydration.
 *  E. A server sort: the data answers `$default` (SortPlan Stage 2), so
 *     nothing is requested after construction; a sort change is one request.
 *
 * None of this warns: a query-key change projects the new key's empty family
 * right before its first page is requested, which is not a "pagination
 * invariant" violation (Stage 5а). Sections B and C check console.warn.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { Palistor, defineList, useForm } from "../index";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const idsOf = (list: any): string[] => list.items.map((item: any) => item.id);

type User = { id: string; name: string };

/** 45 users: 3 pages of 20, the last one has 5. */
const ALL: User[] = Array.from({ length: 45 }, (_, i) => ({ id: `u${i + 1}`, name: `User ${i + 1}` }));
const FIRST_PAGE = ALL.slice(0, 20);
const idRange = (from: number, to: number) => ALL.slice(from - 1, to).map((user) => user.id);

// ─── A. Nested lists inside rows ─────────────────────────────────────────────

describe("initialData: nested lists inside rows", () => {
  const DATA = {
    users: [
      { id: "u1", name: "Alice", contacts: [{ id: "c1", phone: "+1" }, { id: "c2", phone: "+2" }] },
      { id: "u2", name: "Bob" },
      { id: "u3", name: "Carol", contacts: [] },
    ],
  };

  function nestedStore() {
    const resolver = vi.fn(async (owner: any) => [{ id: `fetched-${owner.id}`, phone: "+0" }]);
    const store = new Palistor({
      config: {
        users: defineList<any>({
          template: {
            id: { value: "" },
            name: { value: "" },
            contacts: defineList<any>({
              template: { id: { value: "" }, phone: { value: "" } },
              resolve: { resolver, onError: vi.fn() } as any,
            }),
          } as any,
        }),
      },
      initialData: DATA,
    } as any) as any;
    const contactsOf = (id: string) => store.proxy.users.getById(id).contacts;
    return { store, resolver, contactsOf };
  }

  it("the nested rows become the membership of their owner's list, with its values, not dirty", () => {
    const { store, contactsOf } = nestedStore();
    expect(idsOf(store.proxy.users)).toEqual(["u1", "u2", "u3"]);
    expect(idsOf(contactsOf("u1"))).toEqual(["c1", "c2"]);
    expect(contactsOf("u1").items.map((contact: any) => contact.phone.value)).toEqual(["+1", "+2"]);
    expect(idsOf(contactsOf("u3"))).toEqual([]);

    // The shape that went in comes back; a row that carried no nested list has no key for it.
    expect(store.getValues()).toEqual(DATA);
    // The owner's row holds its own fields only: the nested rows are entities of their own, owned by it.
    expect(store.entityRegistry.get("u1")).toEqual({ id: "u1", name: "Alice" });
    expect(store.entityRegistry.get("c1")).toEqual({ id: "c1", phone: "+1" });
    expect([...store.entityRegistry.getChildrenByOwner("u1")]).toEqual(["c1", "c2"]);

    expect(contactsOf("u1").dirty).toBe(false);
    expect(contactsOf("u3").dirty).toBe(false);
    expect(store.proxy.users.dirty).toBe(false);
    expect(store.proxy.users.getById("u1").dirty).toBe(false);
    expect(store.proxy.dirty).toBe(false);
  });

  it("the nested data is the list's baseline: an edit is dirty against it, and the form reset returns to it", () => {
    const { store, contactsOf } = nestedStore();
    /** The nested list, the row that owns it, the list of that row, the form. */
    const chain = () => [contactsOf("u1").dirty, store.proxy.users.getById("u1").dirty, store.proxy.users.dirty, store.proxy.dirty];
    contactsOf("u1").remove("c2");
    contactsOf("u1").add({ id: "c9", phone: "+9" });
    expect(idsOf(contactsOf("u1"))).toEqual(["c1", "c9"]);
    expect(chain()).toEqual([true, true, true, true]);

    store.reset();
    expect(idsOf(contactsOf("u1"))).toEqual(["c1", "c2"]);
    expect(chain()).toEqual([false, false, false, false]);
  });

  it("the form reset keeps the server's result: the list stays resolved, and reading it requests nothing", async () => {
    const { store, resolver, contactsOf } = nestedStore();
    contactsOf("u1").remove("c2");

    store.reset();
    expect(contactsOf("u1").resolveStatus).toBe("resolved");
    expect(contactsOf("u1").loading).toBe(false);
    expect(idsOf(contactsOf("u1"))).toEqual(["c1", "c2"]);
    await flush();
    // Before Stage 5а the reset left the list idle: this read fetched it, and the fetched rows replaced the server's.
    expect(resolver).not.toHaveBeenCalled();
    expect(idsOf(contactsOf("u1"))).toEqual(["c1", "c2"]);

    // A list that had no data is still fetched when read, once.
    void contactsOf("u2").items;
    await flush();
    store.reset();
    void contactsOf("u2").items;
    await flush();
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(idsOf(contactsOf("u2"))).toEqual(["fetched-u2"]);
  });

  it("a nested list that carried data is resolved and never fetched; one that did not is fetched once read", async () => {
    const { store, resolver, contactsOf } = nestedStore();
    expect(contactsOf("u1").resolveStatus).toBe("resolved");
    expect(contactsOf("u3").resolveStatus).toBe("resolved"); // an empty array is a result too
    expect(contactsOf("u2").resolveStatus).toBe("idle");
    expect(contactsOf("u1").loading).toBe(false);

    void contactsOf("u1").items;
    void contactsOf("u3").items;
    await flush();
    expect(resolver).not.toHaveBeenCalled();

    void contactsOf("u2").items;
    await flush();
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(resolver.mock.calls[0][0]).toMatchObject({ id: "u2", name: "Bob" });
    expect(idsOf(contactsOf("u2"))).toEqual(["fetched-u2"]);
    expect(idsOf(contactsOf("u1"))).toEqual(["c1", "c2"]);
    expect(store.proxy.dirty).toBe(false);
  });
});

// ─── B. The first page of a paginated list ───────────────────────────────────

interface PagedOptions {
  mode?: "paged" | "cursor" | "infinite";
  /** A server filter field `q` (the resolver filters by it). */
  filter?: boolean;
  /** Debounce of `q`, ms. */
  debounce?: number;
  /** A server sort by the row number (param `n`), `$default: "-id"`; the resolver sorts by ctx.sort. */
  sort?: boolean;
  initialData?: unknown;
  server?: boolean;
}

/**
 * One paginated list over ALL. paged: the resolver slices by offset and
 * reports `total`; cursor / infinite: it threads `nextCursor` (the next start
 * index as a string) and reports no total.
 */
function pagedStore(opts: PagedOptions = {}) {
  const mode = opts.mode ?? "paged";
  const calls: Array<Record<string, unknown>> = [];
  const resolver = vi.fn(async (_values: any, _store: any, ctx: any) => {
    const req = ctx.page;
    const q = opts.filter ? String(ctx.filter.values.q) : "";
    let rows = q ? ALL.filter((user) => user.name.includes(q)) : ALL;
    if (opts.sort && ctx.sort.by[0]?.dir === "desc") rows = [...rows].reverse();
    if (mode === "paged") {
      calls.push({ page: req.page, offset: req.offset, ...(opts.filter ? { q } : {}), ...(opts.sort ? { sort: ctx.sort.key } : {}) });
      return { items: rows.slice(req.offset, req.offset + req.pageSize), total: rows.length };
    }
    calls.push({ page: req.page, cursor: req.cursor });
    const start = req.cursor == null ? 0 : Number(req.cursor);
    const items = rows.slice(start, start + req.pageSize);
    const next = start + items.length;
    return { items, nextCursor: next < rows.length ? String(next) : null };
  });
  const store = new Palistor({
    config: {
      users: defineList<User>({
        template: { id: { value: "" }, name: { value: "" } },
        ...(opts.filter ? { filter: { q: opts.debounce ? { value: "", debounce: opts.debounce } : "" } } : {}),
        ...(opts.sort ? { sort: { $default: "-id", id: { param: "n" } } } : {}),
        resolve: { resolver: resolver as any, pagination: { pageSize: 20, mode } as any },
      }),
    },
    ...(opts.initialData === undefined ? {} : { initialData: opts.initialData }),
    ...(opts.server === undefined ? {} : { server: opts.server }),
  } as any) as any;
  return { store, list: store.proxy.users, calls, resolver };
}

describe("initialData: the first page of a paginated list", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { warn = vi.spyOn(console, "warn"); });
  afterEach(() => {
    const warned = warn.mock.calls.map((c: unknown[]) => String(c[0]));
    warn.mockRestore();
    expect(warned).toEqual([]);
  });

  /** What a component reads off a paginated list. */
  const read = (list: any) => ({
    ids: idsOf(list),
    page: list.page,
    pageCount: list.pageCount,
    total: list.total,
    serverTotal: list.serverTotal,
    hasNextPage: list.hasNextPage,
    hasPrevPage: list.hasPrevPage,
    status: list.resolveStatus,
    loading: list.loading,
    isFetching: list.isFetching,
    isInitialLoading: list.isInitialLoading,
    isStaleFromStorage: list.isStaleFromStorage,
    dirty: list.dirty,
  });

  it("`{ items, total }` is filed as a fetched page: the state a store has after fetching that page", async () => {
    const seeded = pagedStore({ initialData: { users: { items: FIRST_PAGE, total: 45 } } });
    const fetched = pagedStore();
    void fetched.list.items;
    await flush();
    expect(fetched.calls).toEqual([{ page: 1, offset: 0 }]);

    const loaded = {
      ids: idRange(1, 20),
      page: 1,
      pageCount: 3,
      total: 45,
      serverTotal: 45,
      hasNextPage: true,
      hasPrevPage: false,
      status: "resolved",
      loading: false,
      isFetching: false,
      isInitialLoading: false,
      isStaleFromStorage: false,
      dirty: false,
    };
    expect(read(seeded.list)).toEqual(loaded);
    expect(read(fetched.list)).toEqual(loaded);
    expect(seeded.store.getValues()).toEqual(fetched.store.getValues());
    expect(seeded.store.proxy.dirty).toBe(false);

    // The page's rows are its baseline: the form reset undoes a removal and a row edit, in both stores.
    for (const { store, list } of [seeded, fetched]) {
      list.remove("u2");
      list.getById("u1").name.value = "edited";
      expect(list.dirty).toBe(true);
      store.reset();
    }
    expect(read(seeded.list)).toEqual(loaded);
    expect(read(fetched.list)).toEqual(loaded);
    expect(seeded.store.getValues()).toEqual(fetched.store.getValues());

    await flush();
    expect(seeded.calls).toEqual([]); // not right after construction, not after the reads
  });

  it("the second page is fetched as usual; the way back to the first is served from the cache", async () => {
    const { list, calls } = pagedStore({ initialData: { users: { items: FIRST_PAGE, total: 45 } } });
    list.setPage(2);
    await flush();
    expect(calls).toEqual([{ page: 2, offset: 20 }]);
    expect(list.page).toBe(2);
    expect(idsOf(list)).toEqual(idRange(21, 40));
    expect(list.hasPrevPage).toBe(true);

    list.setPage(1);
    await flush();
    expect(calls).toEqual([{ page: 2, offset: 20 }]);
    expect(list.page).toBe(1);
    expect(idsOf(list)).toEqual(idRange(1, 20));

    list.setPage(2); // and the fetched page is cached next to it
    await flush();
    expect(calls).toHaveLength(1);
    expect(idsOf(list)).toEqual(idRange(21, 40));
  });

  it("a bare array is the first page too: resolved, without a total", async () => {
    const { list, calls } = pagedStore({ initialData: { users: FIRST_PAGE } });
    expect(list.resolveStatus).toBe("resolved");
    expect(idsOf(list)).toEqual(idRange(1, 20));
    expect(list.total).toBeUndefined();
    expect(list.hasNextPage).toBe(true); // a full page without a total: there may be more
    expect(list.dirty).toBe(false);
    await flush();
    expect(calls).toEqual([]);

    list.setPage(2);
    await flush();
    expect(calls).toEqual([{ page: 2, offset: 20 }]);
    expect(list.total).toBe(45); // the fetched page brought the total
  });

  it("cursor mode: `nextCursor` of the data is the cursor of the second page's request", async () => {
    const { list, calls } = pagedStore({ mode: "cursor", initialData: { users: { items: FIRST_PAGE, nextCursor: "20" } } });
    expect(list.resolveStatus).toBe("resolved");
    expect(list.hasNextPage).toBe(true);
    await flush();
    expect(calls).toEqual([]);

    list.nextPage();
    await flush();
    expect(calls).toEqual([{ page: 2, cursor: "20" }]);
    expect(list.page).toBe(2);
    expect(idsOf(list)).toEqual(idRange(21, 40));

    list.prevPage();
    await flush();
    expect(calls).toHaveLength(1);
    expect(list.page).toBe(1);
    expect(idsOf(list)).toEqual(idRange(1, 20));
  });

  it("`hasMore: false` in the data ends the feed although the page is full: no next page, no request", async () => {
    const cursor = pagedStore({ mode: "cursor", initialData: { users: { items: FIRST_PAGE, hasMore: false } } });
    expect(cursor.list.hasNextPage).toBe(false);
    cursor.list.nextPage();

    const infinite = pagedStore({ mode: "infinite", initialData: { users: { items: FIRST_PAGE, hasMore: false } } });
    expect(infinite.list.hasNextPage).toBe(false);
    infinite.list.loadMore();

    await flush();
    expect(cursor.calls).toEqual([]);
    expect(infinite.calls).toEqual([]);
    expect(idsOf(infinite.list)).toEqual(idRange(1, 20));
  });

  it("infinite mode: the data is the first loaded page, loadMore() continues from its cursor", async () => {
    const { list, calls } = pagedStore({ mode: "infinite", initialData: { users: { items: FIRST_PAGE, nextCursor: "20" } } });
    expect(list.resolveStatus).toBe("resolved");
    expect(list.loadedPages).toEqual([{ ordinal: 1, ids: idRange(1, 20) }]);
    expect(list.hasNextPage).toBe(true);
    await flush();
    expect(calls).toEqual([]);

    list.loadMore();
    await flush();
    expect(calls).toEqual([{ page: 2, cursor: "20" }]);
    expect(idsOf(list)).toEqual(idRange(1, 40));
    expect(list.dirty).toBe(false);
  });
});

// ─── C. Server filters ───────────────────────────────────────────────────────

describe("initialData: a list with a server filter", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { warn = vi.spyOn(console, "warn"); });
  afterEach(() => {
    const warned = warn.mock.calls.map((c: unknown[]) => String(c[0]));
    warn.mockRestore();
    expect(warned).toEqual([]);
  });

  it("paginated: no request right after construction; a filter change is one request for the first page", async () => {
    const { list, calls } = pagedStore({ filter: true, initialData: { users: { items: FIRST_PAGE, total: 45 } } });
    expect(idsOf(list)).toEqual(idRange(1, 20));
    expect(list.filter.isPending).toBe(false);
    await flush();
    expect(calls).toEqual([]);

    list.filter.q.value = "User 3"; // u3, u30 … u39
    await flush();
    expect(calls).toEqual([{ page: 1, offset: 0, q: "User 3" }]);
    expect(list.total).toBe(11);
    expect(idsOf(list)).toEqual(["u3", ...idRange(30, 39)]);
  });

  /** A plain list: a server field `q` (optionally debounced) and a client field `only`. */
  function filteredStore(debounce?: number) {
    const calls: Array<Record<string, unknown>> = [];
    const resolver = vi.fn(async (_values: any, _store: any, ctx: any) => {
      calls.push({ ...ctx.filter.values });
      return ALL.filter((user) => user.name.includes(ctx.filter.values.q)).slice(0, 3);
    });
    const store = new Palistor({
      config: {
        users: defineList<User>({
          template: { id: { value: "" }, name: { value: "" } },
          filter: {
            q: debounce ? { value: "", debounce } : "",
            only: { value: "", where: (row: any, value: any) => row.name.endsWith(value) },
          } as any,
          resolve: { resolver: resolver as any },
        }),
      },
      initialData: { users: ALL.slice(0, 3) },
    } as any) as any;
    return { list: store.proxy.users, calls };
  }

  it("not paginated: no request right after construction; a server-field change is one, a client-field change none", async () => {
    const { list, calls } = filteredStore();
    expect(idsOf(list)).toEqual(["u1", "u2", "u3"]);
    expect(list.resolveStatus).toBe("resolved");
    expect(list.filter.isPending).toBe(false);
    await flush();
    expect(calls).toEqual([]);

    list.filter.only.value = "2"; // a `where` field: projected over the initial rows, no request
    await flush();
    expect(calls).toEqual([]);
    expect(idsOf(list)).toEqual(["u2"]);
    list.filter.only.value = "";

    list.filter.q.value = "User 4";
    await flush();
    expect(calls).toEqual([{ q: "User 4", only: "" }]);
    expect(idsOf(list)).toEqual(["u4", "u40", "u41"]);
  });

  it("the data answers the filter's initial values: typing and reverting inside the debounce requests nothing", async () => {
    const plain = filteredStore(30);
    const paged = pagedStore({ filter: true, debounce: 30, initialData: { users: { items: FIRST_PAGE, total: 45 } } });
    for (const { list } of [plain, paged]) {
      list.filter.q.value = "User 4";
      expect(list.filter.isPending).toBe(true);
      list.filter.q.value = "";
    }
    await new Promise<void>((r) => setTimeout(r, 60));
    await flush();
    for (const { list } of [plain, paged]) expect(list.filter.isPending).toBe(false);
    expect(plain.calls).toEqual([]);
    expect(paged.calls).toEqual([]);
    expect(idsOf(plain.list)).toEqual(["u1", "u2", "u3"]);
    expect(idsOf(paged.list)).toEqual(idRange(1, 20));
  });
});

// ─── D. Server render and hydration ──────────────────────────────────────────

describe("initialData: a paginated list under server render and hydration", () => {
  let container: HTMLElement;
  let root: Root | null = null;
  let consoleError: ReturnType<typeof vi.spyOn>;
  const onRecoverableError = vi.fn();

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    onRecoverableError.mockClear();
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container.remove();
    consoleError.mockRestore();
  });

  function Users({ store }: { store: unknown }) {
    const form = useForm(store as any) as any;
    const users = form.users;
    if (users.isInitialLoading) return <em>users-skeleton</em>;
    return (
      <section data-page={`${users.page}/${users.pageCount}`} data-total={users.total}>
        <ul>{users.items.map((user: any) => <li key={user.id}>{user.name.value}</li>)}</ul>
        <button disabled={!users.hasNextPage} onClick={() => users.nextPage()}>next</button>
      </section>
    );
  }

  it("the HTML carries the first page; the client hydrates it, fetches nothing, and fetches the second page on demand", async () => {
    const data = { users: { items: ALL.slice(0, 2), total: 45 } };
    const server = pagedStore({ server: true, initialData: data });
    const html = renderToString(<Users store={server.store} />);
    expect(html).toBe(
      '<section data-page="1/3" data-total="45"><ul><li>User 1</li><li>User 2</li></ul><button>next</button></section>',
    );
    await flush();
    expect(server.calls).toEqual([]);

    container.innerHTML = html;
    const sent = container.firstElementChild;
    const client = pagedStore({ initialData: data });
    await act(async () => {
      root = hydrateRoot(container, <Users store={client.store} />, { onRecoverableError });
      await flush();
    });
    expect(container.innerHTML).toBe(html);
    expect(container.firstElementChild).toBe(sent);
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(client.calls).toEqual([]);

    await act(async () => { container.querySelector("button")!.click(); await flush(); });
    expect(client.calls).toEqual([{ page: 2, offset: 20 }]);
    expect(container.querySelector("section")!.getAttribute("data-page")).toBe("2/3");
    expect(container.querySelectorAll("li")).toHaveLength(20);
    expect(server.calls).toEqual([]);
  });
});

// ─── E. Server sort ──────────────────────────────────────────────────────────

describe("initialData: a paginated list with a server sort", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { warn = vi.spyOn(console, "warn"); });
  afterEach(() => {
    const warned = warn.mock.calls.map((c: unknown[]) => String(c[0]));
    warn.mockRestore();
    expect(warned).toEqual([]);
  });

  it("the data answers `$default`: no request after construction; a sort change is one request for the first page", async () => {
    const newestFirst = [...ALL].reverse();
    const { list, calls } = pagedStore({ sort: true, initialData: { users: { items: newestFirst.slice(0, 20), total: 45 } } });
    expect(idsOf(list)).toEqual(newestFirst.slice(0, 20).map((user) => user.id));
    expect(list.sort.by).toEqual([{ key: "id", dir: "desc" }]);
    expect(list.resolveStatus).toBe("resolved");
    await flush();
    expect(calls).toEqual([]);

    list.setPage(2); // the next page of the same query: fetched under the same sort
    await flush();
    expect(calls).toEqual([{ page: 2, offset: 20, sort: '[["n","desc"]]' }]);

    list.sort.toggle("id"); // desc is the $default: the next step is asc
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({ page: 1, offset: 0, sort: '[["n","asc"]]' });
    expect(list.page).toBe(1);
    expect(idsOf(list)).toEqual(idRange(1, 20));
  });
});
