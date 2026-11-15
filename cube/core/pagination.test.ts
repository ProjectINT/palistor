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
