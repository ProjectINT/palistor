/**
 * Pagination behavior store implements but never tested (Phase 2.5, new).
 *
 *  S1. a debounced server filter on a paginated list: no fetch inside the
 *      debounce, one page-1 fetch after it
 *  S2. the resolver's values: repeatable reads, contained writes
 *  S3. `options.lazy: false` fetches the first page at construction
 *  S4. persist: no write while a root page fetch is in flight; it lands after
 *  S5. deleting the owner while its nested page is in flight files nothing
 *  S6. one owner shown through two lists with a shared template: ONE nested
 *      list (plain and paginated) — one fetch, both views see its rows and its
 *      page pointer
 *  S7. React Suspense: the first page suspends into the fallback, a page move
 *      keeps the rows on screen
 *  S8. useForm: a group child named like a pagination getter (`total`) is a
 *      child, and a page move does not re-render a component reading only it
 */
import { describe, it, expect, vi } from "vitest";
import { Suspense } from "react";
import { act, render, screen } from "@testing-library/react";
import { defineList, Palistor, useForm } from "@impl";

function flush() {
  return new Promise<void>((r) => setTimeout(r, 0));
}
function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

type User = { id: string; name: string };
const ALL: User[] = Array.from({ length: 45 }, (_, i) => ({ id: `u${i + 1}`, name: `User ${i + 1}` }));
const template = { id: { value: "" }, name: { value: "" } };

function slice(rows: User[], ctx: any) {
  return { items: rows.slice(ctx.page.offset, ctx.page.offset + ctx.page.pageSize), total: rows.length };
}

describe("pagination surface", () => {
  it("S1. a debounced server filter: nothing inside the debounce, one page-1 fetch after it", async () => {
    const calls: Array<{ q: unknown; page: number }> = [];
    const store = new Palistor({
      config: {
        users: defineList<User>({
          template,
          filter: { q: { value: "", debounce: 40 } } as any,
          resolve: {
            resolver: async (_v, _s, ctx) => {
              const q = (ctx.filter.values as { q: string }).q;
              calls.push({ q, page: ctx.page!.page });
              return slice(q ? ALL.filter((u) => u.name.includes(q)) : ALL, ctx);
            },
            pagination: { pageSize: 20 },
          },
        }),
      },
    });
    const list = (store.proxy as any).users;
    void list.items;
    await flush();
    list.setPage(2);
    await flush();
    list.filter.q.value = "U";
    await flush();
    list.filter.q.value = "User 4";
    await flush();
    expect(calls.length).toBe(2);
    expect(list.filter.isPending).toBe(true);
    await delay(60);
    expect(calls).toEqual([{ q: "", page: 1 }, { q: "", page: 2 }, { q: "User 4", page: 1 }]);
    expect(list.page).toBe(1);
    expect(list.total).toBe(7);
  });

  it("S2. the resolver's values are repeatable reads; writes to them stay inside the run", async () => {
    let release!: () => void;
    const seen: unknown[] = [];
    const store = new Palistor({
      config: {
        search: { value: "a" },
        users: defineList<User>({
          template,
          resolve: {
            resolver: async (values: any, _s, ctx) => {
              seen.push(values.search);
              await new Promise<void>((r) => (release = r));
              seen.push(values.search);
              values.search = "written by the resolver";
              seen.push(values.search);
              return slice(ALL, ctx);
            },
            pagination: { pageSize: 20 },
          },
        }),
      },
    });
    void (store.proxy as any).users.items;
    await flush();
    (store.proxy as any).search.value = "b";
    release();
    await flush();
    await flush();
    expect(seen.slice(0, 3)).toEqual(["a", "a", "a"]);
    expect((store.proxy as any).search.value).toBe("b");
  });

  it("S3. options.lazy: false fetches the first page at construction", async () => {
    const resolver = vi.fn(async (_v: unknown, _s: unknown, ctx: any) => slice(ALL, ctx));
    const store = new Palistor({
      config: {
        users: defineList<User>({
          template,
          resolve: { resolver: resolver as any, pagination: { pageSize: 20 }, options: { lazy: false } },
        }),
      },
    });
    await flush();
    expect(resolver).toHaveBeenCalledTimes(1);
    expect((store.proxy as any).users.resolveStatus).toBe("resolved");
    expect((store.proxy as any).users.length).toBe(20);
  });

  it("S4. persist: no write while a root page fetch is in flight; the window is written after it", async () => {
    const writes: string[] = [];
    const driver = {
      getItem: () => null,
      setItem: (_k: string, v: string) => void writes.push(v),
      removeItem: () => {},
    };
    let release!: () => void;
    const store = new Palistor({
      config: {
        note: { value: "" },
        users: defineList<User>({
          template,
          resolve: {
            resolver: async (_v, _s, ctx) => {
              await new Promise<void>((r) => (release = r));
              return slice(ALL, ctx);
            },
            pagination: { pageSize: 20 },
          },
        }),
      },
    });
    await store.persist.enable({ key: "k", driver, debounce: 0 });
    void (store.proxy as any).users.items;
    await flush();
    const before = writes.length;
    (store.proxy as any).note.value = "typed";
    await store.persist.flush();
    expect(writes.length).toBe(before);
    release();
    await flush();
    const last = JSON.parse(writes[writes.length - 1]);
    expect(last.note).toBe("typed");
    expect(last.users.length).toBe(20);
    expect(last.__pagination.users.currentPage).toBe(1);
  });

  it("S5. deleting the owner while its nested page is in flight files nothing", async () => {
    let release!: () => void;
    const store = new Palistor({
      config: {
        owners: defineList<{ id: string }>({
          template: {
            id: { value: "" },
            pets: [
              { id: { value: "" }, kind: { value: "" } },
              {
                resolve: {
                  resolver: async (owner: any, _s: any, ctx: any) => {
                    await new Promise<void>((r) => (release = r));
                    return { items: [{ id: `${owner.id}-p${ctx.page.page}`, kind: "cat" }], total: 1 };
                  },
                  pagination: { pageSize: 5 },
                },
              },
            ],
          } as any,
          resolve: { resolver: async () => [{ id: "o1" }, { id: "o2" }] },
        }),
      },
    });
    const owners = (store.proxy as any).owners;
    void owners.items;
    await flush();
    void owners.getById("o1").pets.items;
    await flush();
    store.delete("o1");
    release();
    await flush();
    expect(store.entityRegistry.has("o1-p1")).toBe(false);
    expect(owners.items.map((o: any) => o.id)).toEqual(["o2"]);
  });

  for (const paginated of [false, true]) {
    it(`S6. one owner through two lists with a shared template: one nested list (${paginated ? "paginated" : "plain"})`, async () => {
      const resolver = vi.fn(async (owner: any, _s: any, ctx: any) => {
        const page = ctx?.page?.page ?? 1;
        const items = [{ id: `${owner.id}-p${page}`, kind: "cat" }];
        return paginated ? { items, total: 2 } : items;
      });
      const shared = {
        id: { value: "" },
        pets: [
          { id: { value: "" }, kind: { value: "" } },
          { resolve: { resolver, ...(paginated ? { pagination: { pageSize: 1 } } : {}) } },
        ],
      } as any;
      const store = new Palistor({
        config: {
          mine: defineList<{ id: string }>({ template: shared, resolve: { resolver: async () => [{ id: "o1" }] } }),
          all: defineList<{ id: string }>({ template: shared, resolve: { resolver: async () => [{ id: "o1" }, { id: "o2" }] } }),
        },
      });
      const p = store.proxy as any;
      void p.mine.items;
      void p.all.items;
      await flush();
      void p.mine.getById("o1").pets.items;
      await flush();
      void p.all.getById("o1").pets.items;
      await flush();
      expect(resolver).toHaveBeenCalledTimes(1);
      expect(p.all.getById("o1").pets.items.map((i: any) => i.id)).toEqual(["o1-p1"]);
      expect(p.mine.getById("o1").pets.items.map((i: any) => i.id)).toEqual(["o1-p1"]);
      if (paginated) {
        p.mine.getById("o1").pets.nextPage();
        await flush();
        expect(p.all.getById("o1").pets.page).toBe(2);
        expect(p.all.getById("o1").pets.items.map((i: any) => i.id)).toEqual(["o1-p2"]);
      } else {
        p.mine.getById("o1").pets.add({ id: "x", kind: "dog" });
        expect(p.all.getById("o1").pets.items.map((i: any) => i.id)).toEqual(["o1-p1", "x"]);
        expect(p.all.getById("o1").pets.dirty).toBe(true);
      }
    });
  }

  it("S7. React Suspense: the first page suspends into the fallback, a page move keeps the rows", async () => {
    let release!: () => void;
    const store = new Palistor({
      config: {
        users: defineList<User>({
          template,
          resolve: {
            resolver: async (_v, _s, ctx) => {
              await new Promise<void>((r) => (release = r));
              return slice(ALL, ctx);
            },
            pagination: { pageSize: 20 },
            options: { suspense: true },
          },
        }),
      },
    });
    function Rows() {
      const form = useForm(store) as any;
      return <ul data-testid="rows">{form.users.map((u: any) => <li key={u.id}>{u.name.value}</li>)}</ul>;
    }
    render(
      <Suspense fallback={<span data-testid="fallback">…</span>}>
        <Rows />
      </Suspense>,
    );
    await act(async () => {
      await flush();
    });
    expect(screen.getByTestId("fallback")).toBeTruthy();
    await act(async () => {
      release();
      await flush();
    });
    expect(screen.getByTestId("rows").children.length).toBe(20);

    await act(async () => {
      (store.proxy as any).users.setPage(2);
      await flush();
    });
    expect(screen.queryByTestId("fallback")).toBeNull();
    expect(screen.getByTestId("rows").children[0].textContent).toBe("User 1");
    await act(async () => {
      release();
      await flush();
    });
    expect(screen.getByTestId("rows").children[0].textContent).toBe("User 21");
  });

  it("S8. useForm: a group child named `total` is a child; a page move does not re-render a component reading only it", async () => {
    const store = new Palistor({
      config: {
        total: { value: 0 },
        users: defineList<User>({
          template,
          resolve: { resolver: async (_v, _s, ctx) => slice(ALL, ctx), pagination: { pageSize: 20 } },
        }),
      },
    });
    let renders = 0;
    function Total() {
      const form = useForm(store) as any;
      renders++;
      return <span data-testid="total">{form.total.value}</span>;
    }
    render(<Total />);
    await act(async () => {
      void (store.proxy as any).users.items;
      await flush();
    });
    const before = renders;
    await act(async () => {
      (store.proxy as any).users.setPage(2);
      await flush();
    });
    expect(renders).toBe(before);
    await act(async () => {
      (store.proxy as any).total.value = 5;
    });
    expect(screen.getByTestId("total").textContent).toBe("5");
  });
});
