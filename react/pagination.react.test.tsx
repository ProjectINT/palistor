/**
 * Pagination through useForm (tracking proxy).
 *
 * - a Pager reading ONLY `page` / `pageCount` (never items/map) re-renders on
 *   `setPage` — the pagination getters are tracked by the ListState version;
 * - a spinner bound to `isFetching` clears when the in-flight set drains;
 * - a cached-page switch re-renders the rows synchronously with no resolver call;
 * - (Phase 2) an infinite footer bound to `isFetchingNextPage` / `loadedPages`
 *   re-renders on `loadMore`, and row proxies keep identity across the append
 *   so `React.memo` rows bail out.
 */
import { describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { Palistor } from "../store/store";
import { defineList } from "../store/defineList";
import { useForm } from "./useForm";

function flushPromises() {
  return new Promise<void>((r) => setTimeout(r, 0));
}

type User = { id: string; name: string };
const ALL: User[] = Array.from({ length: 25 }, (_, i) => ({ id: `u${i + 1}`, name: `User ${i + 1}` }));

function makeStore() {
  const resolver = vi.fn(async (_v: unknown, _s: unknown, ctx: any) => {
    const r = ctx.page;
    return { items: ALL.slice(r.offset, r.offset + r.pageSize), total: ALL.length };
  });
  const store = new Palistor({
    config: {
      users: defineList<User>({
        template: { id: { value: "" }, name: { value: "" } },
        resolve: { resolver: resolver as any, pagination: { pageSize: 10 } },
      }),
    },
  });
  return { store, resolver };
}

describe("pagination + useForm", () => {
  it("a Pager reading only page/pageCount re-renders on setPage; rows switch without a resolver call", async () => {
    const { store, resolver } = makeStore();
    let pagerRenders = 0;

    function Pager() {
      const form = useForm(store) as any;
      pagerRenders++;
      return (
        <span data-testid="pager">
          {form.users.page} / {form.users.pageCount}
        </span>
      );
    }
    function Rows() {
      const form = useForm(store) as any;
      return (
        <ul data-testid="rows">
          {form.users.map((u: any) => (
            <li key={u.id}>{u.name.value}</li>
          ))}
        </ul>
      );
    }

    render(
      <>
        <Pager />
        <Rows />
      </>,
    );
    await act(async () => {
      await flushPromises();
    });
    expect(screen.getByTestId("pager").textContent).toBe("1 / 3");
    expect(screen.getByTestId("rows").children.length).toBe(10);
    expect(resolver).toHaveBeenCalledTimes(1);

    await act(async () => {
      (store.proxy.users as any).setPage(2);
      await flushPromises();
    });
    expect(screen.getByTestId("pager").textContent).toBe("2 / 3");
    expect(screen.getByTestId("rows").children[0].textContent).toBe("User 11");
    expect(resolver).toHaveBeenCalledTimes(2);

    // Cached page: synchronous projection, the Pager re-renders, no resolver.
    const before = pagerRenders;
    await act(async () => {
      (store.proxy.users as any).prevPage();
    });
    expect(pagerRenders).toBeGreaterThan(before);
    expect(screen.getByTestId("pager").textContent).toBe("1 / 3");
    expect(screen.getByTestId("rows").children[0].textContent).toBe("User 1");
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it("a spinner bound to isFetching clears when inFlight drains", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const store = new Palistor({
      config: {
        users: defineList<User>({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: {
            resolver: async (_v, _s, ctx) => {
              await gate;
              const r = ctx.page!;
              return { items: ALL.slice(r.offset, r.offset + r.pageSize), total: ALL.length };
            },
            pagination: { pageSize: 10 },
          },
        }),
      },
    });

    function Spinner() {
      const form = useForm(store) as any;
      return <span data-testid="spin">{form.users.isFetching ? "…" : "idle"}</span>;
    }
    render(<Spinner />);
    expect(screen.getByTestId("spin").textContent).toBe("idle");

    await act(async () => {
      void (store.proxy.users as any).items; // lazy trigger
      await flushPromises();
    });
    expect(screen.getByTestId("spin").textContent).toBe("…");

    await act(async () => {
      release();
      await flushPromises();
    });
    expect(screen.getByTestId("spin").textContent).toBe("idle");
  });

  it("infinite: a footer reading only isFetchingNextPage/loadedPages re-renders on loadMore", async () => {
    let release!: () => void;
    let gate = new Promise<void>((r) => (release = r));
    const store = new Palistor({
      config: {
        users: defineList<User>({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: {
            resolver: async (_v, _s, ctx) => {
              await gate;
              const r = ctx.page!;
              return { items: ALL.slice(r.offset, r.offset + r.pageSize), total: ALL.length };
            },
            pagination: { pageSize: 10, mode: "infinite" },
          },
        }),
      },
    });

    let footerRenders = 0;
    function Footer() {
      const form = useForm(store) as any;
      footerRenders++;
      return (
        <span data-testid="foot">
          {form.users.loadedPages.length}
          {form.users.isFetchingNextPage ? "…" : ""}
        </span>
      );
    }
    function Rows() {
      const form = useForm(store) as any;
      const rows = form.users.items as object[];
      return <ul data-testid="rows">{rows.map((u: any) => <li key={u.id}>{u.name.value}</li>)}</ul>;
    }
    render(
      <>
        <Footer />
        <Rows />
      </>,
    );
    await act(async () => {
      release();
      await flushPromises();
    });
    expect(screen.getByTestId("foot").textContent).toBe("1");
    expect(screen.getByTestId("rows").children.length).toBe(10);
    const firstRowBefore = (store.proxy.users as any).items[0];

    gate = new Promise<void>((r) => (release = r));
    const before = footerRenders;
    await act(async () => {
      (store.proxy.users as any).loadMore();
      await flushPromises();
    });
    expect(footerRenders).toBeGreaterThan(before);
    expect(screen.getByTestId("foot").textContent).toBe("1…");

    await act(async () => {
      release();
      await flushPromises();
    });
    expect(screen.getByTestId("foot").textContent).toBe("2");
    expect(screen.getByTestId("rows").children.length).toBe(20);
    // Row proxies are cached per (list, entity): identity survives the append,
    // so `React.memo` rows above the fold bail out instead of re-rendering.
    expect((store.proxy.users as any).items[0]).toBe(firstRowBefore);
  });
});
