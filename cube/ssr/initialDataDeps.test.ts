/**
 * What restarts a resolve whose result came as `initialData`
 * (experiments/SsrPlan.md, Stage 3), Cube only. No run has read anything, so
 * auto-tracking knows nothing yet: until the first real run such a resolve
 * follows only what the config declares — `resolve.deps`, the
 * `resolve.contextDeps` keys — and `reload()`. The first real run records
 * what it reads, and from then on those reads restart it as usual.
 *
 * The same rule in both resolve mechanisms: a values resolve (a group here;
 * a leaf and a plain list share its state machine) and a paginated list's
 * page cache, which is keyed on the declared deps until its first fetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Palistor, defineList } from "../index";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * A group resolve that reads four things: a declared value (`userId`), an
 * undeclared one (`plan`), a declared context key (`accountId`) and an
 * undeclared one (`locale`). Its result spells out what the run saw.
 */
function carStore() {
  const resolver = vi.fn(async (values: any, store: any) => ({
    brand: [values.userId, values.plan, store.context.accountId, store.context.locale].join("/"),
  }));
  const store = new Palistor({
    config: {
      userId: { value: "u1" },
      plan: { value: "free" },
      unrelated: { value: "" },
      car: {
        resolve: { resolver, onError: vi.fn(), deps: ["userId"], contextDeps: ["accountId"] },
        brand: { value: "" },
      },
    },
    context: { accountId: "acc1", locale: "en" },
    initialData: { car: { brand: "server brand" } },
  } as any) as any;
  const brand = () => store.proxy.car.brand.value as string;
  return { store, resolver, brand };
}

describe("a group resolve that got initialData", () => {
  it("is not run by a read: the data is its result", async () => {
    const { resolver, brand } = carStore();
    expect(brand()).toBe("server brand");
    await flush();
    expect(resolver).not.toHaveBeenCalled();
  });

  it("restarts when a path listed in `deps` changes", async () => {
    const { store, resolver, brand } = carStore();
    store.proxy.userId.value = "u2";
    await flush();
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(brand()).toBe("u2/free/acc1/en");
  });

  it("restarts when a `contextDeps` key changes; the same value does not restart it", async () => {
    const { store, resolver, brand } = carStore();
    store.setContext({ accountId: "acc1" });
    await flush();
    expect(resolver).not.toHaveBeenCalled();

    store.setContext({ accountId: "acc2" });
    await flush();
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(brand()).toBe("u1/free/acc2/en");
  });

  it("does not restart on a value or a context key it did not declare, before its first real run", async () => {
    const { store, resolver, brand } = carStore();
    store.proxy.plan.value = "pro"; // the resolver would read it
    store.proxy.unrelated.value = "x";
    store.setContext({ locale: "de" }); // and this
    await flush();
    expect(resolver).not.toHaveBeenCalled();
    expect(brand()).toBe("server brand");
  });

  it("after the first real run, what that run read restarts it: auto-tracking is back", async () => {
    const { store, resolver, brand } = carStore();
    store.proxy.userId.value = "u2"; // a declared dep: the first real run
    await flush();
    expect(resolver).toHaveBeenCalledTimes(1);

    store.proxy.plan.value = "pro"; // read by that run, never declared
    await flush();
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(brand()).toBe("u2/pro/acc1/en");

    store.setContext({ locale: "de" }); // a context key that run read
    await flush();
    expect(resolver).toHaveBeenCalledTimes(3);
    expect(brand()).toBe("u2/pro/acc1/de");

    store.proxy.unrelated.value = "x"; // still nothing the resolver reads
    await flush();
    expect(resolver).toHaveBeenCalledTimes(3);
  });
});

describe("a list resolve that got initialData", () => {
  function usersStore() {
    const resolver = vi.fn(async (values: any) => [{ id: `fetched-${values.search}-${values.sort}`, name: "Fetched" }]);
    const store = new Palistor({
      config: {
        search: { value: "" },
        sort: { value: "asc" },
        users: defineList<any>({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver, onError: vi.fn(), deps: ["search"] } as any,
        }),
      },
      initialData: { users: [{ id: "u1", name: "Alice" }] },
    } as any) as any;
    const ids = () => store.proxy.users.items.map((item: any) => item.id) as string[];
    return { store, resolver, ids };
  }

  it("reload() runs the resolver, and that run brings auto-tracking back", async () => {
    const { store, resolver, ids } = usersStore();
    expect(ids()).toEqual(["u1"]);
    store.proxy.sort.value = "desc"; // undeclared: nothing before the first real run
    await flush();
    expect(resolver).not.toHaveBeenCalled();

    store.proxy.users.reload();
    await flush();
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(ids()).toEqual(["fetched--desc"]);
    expect(store.proxy.users.dirty).toBe(false); // the fetched rows are the new baseline

    store.proxy.sort.value = "asc"; // the reload read it
    await flush();
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(ids()).toEqual(["fetched--asc"]);
  });

  it("restarts when a path listed in `deps` changes", async () => {
    const { store, resolver, ids } = usersStore();
    store.proxy.search.value = "al";
    await flush();
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(ids()).toEqual(["fetched-al-asc"]);
  });
});

describe("a paginated list that got its first page as initialData", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  // A query-key change is not a "pagination invariant" violation: nothing here warns (Stage 5а).
  beforeEach(() => { warn = vi.spyOn(console, "warn"); });
  afterEach(() => {
    const warned = warn.mock.calls.map((c: unknown[]) => String(c[0]));
    warn.mockRestore();
    expect(warned).toEqual([]);
  });

  function pagedStore() {
    const calls: Array<{ page: number; search: string; sort: string }> = [];
    const resolver = vi.fn(async (values: any, _store: any, ctx: any) => {
      calls.push({ page: ctx.page.page, search: values.search, sort: values.sort });
      return { items: [{ id: `fetched-${values.search}-${values.sort}`, name: "Fetched" }], total: 1 };
    });
    const store = new Palistor({
      config: {
        search: { value: "" },
        sort: { value: "asc" },
        users: defineList<any>({
          template: { id: { value: "" }, name: { value: "" } },
          resolve: { resolver: resolver as any, deps: ["search"], pagination: { pageSize: 2 } },
        }),
      },
      initialData: { users: { items: [{ id: "u1", name: "Alice" }, { id: "u2", name: "Bob" }], total: 5 } },
    } as any) as any;
    const ids = () => store.proxy.users.items.map((item: any) => item.id) as string[];
    return { store, calls, ids };
  }

  it("is keyed on the declared `deps`: an undeclared value the resolver would read fetches nothing", async () => {
    const { store, calls, ids } = pagedStore();
    store.proxy.sort.value = "desc";
    await flush();
    expect(calls).toEqual([]);
    expect(ids()).toEqual(["u1", "u2"]);
  });

  it("a change of a declared dep is a new query: one fetch of the first page; then auto-tracked reads re-key it too", async () => {
    const { store, calls, ids } = pagedStore();
    store.proxy.search.value = "al";
    await flush();
    expect(calls).toEqual([{ page: 1, search: "al", sort: "asc" }]);
    expect(ids()).toEqual(["fetched-al-asc"]);

    store.proxy.sort.value = "desc"; // read by that fetch, never declared
    await flush();
    expect(calls).toEqual([{ page: 1, search: "al", sort: "asc" }, { page: 1, search: "al", sort: "desc" }]);
    expect(ids()).toEqual(["fetched-al-desc"]);
  });

  it("reload() refetches the current page", async () => {
    const { store, calls, ids } = pagedStore();
    store.proxy.users.reload();
    await flush();
    expect(calls).toEqual([{ page: 1, search: "", sort: "asc" }]);
    expect(ids()).toEqual(["fetched--asc"]);
  });
});
