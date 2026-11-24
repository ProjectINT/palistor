/**
 * The filter's apply mode (SortPlan.md decision 14, Stage 3), Cube only:
 * `$apply: "manual"` on the block, `apply` on a field. A manual field's value
 * is a draft; the list (projection, ctx.filter, the server key, isActive,
 * activeCount) follows its applied value, which only `filter.apply()` moves.
 * A block without `$apply` behaves as before (cube/contract/sliceE).
 */
import { describe, it, expect, vi } from "vitest";
import { Palistor } from "../palistor";
import { defineList } from "../defineList";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Customer = { id: string; name: string; role: string };
const CUSTOMERS: Customer[] = [
  { id: "c1", name: "Alice", role: "admin" },
  { id: "c2", name: "Bob", role: "user" },
  { id: "c3", name: "Alina", role: "user" },
  { id: "c4", name: "Carl", role: "admin" },
];
const template = { id: { value: "" }, name: { value: "" }, role: { value: "" } };
const byName = (row: any, q: string) => String(row.name).toLowerCase().includes(String(q).toLowerCase());

const idsOf = (list: any): string[] => list.items.map((item: any) => item.id);

interface Call { values: Record<string, unknown>; params: unknown; key: string; page?: number }

/** A list whose resolver filters CUSTOMERS by `role` and `search` (whichever the block has) and records each ctx.filter. */
function serverStore(filter: Record<string, unknown>, opts: { pageSize?: number; initialData?: unknown } = {}) {
  const calls: Call[] = [];
  const resolver = vi.fn(async (_values: unknown, _store: unknown, ctx: any) => {
    const { values } = ctx.filter;
    calls.push({ values: { ...values }, params: ctx.filter.params, key: ctx.filter.key, ...(ctx.page ? { page: ctx.page.page } : {}) });
    const rows = CUSTOMERS.filter((c) => (!values.role || c.role === values.role) && (!values.search || byName(c, values.search)));
    if (!ctx.page) return rows;
    return { items: rows.slice(ctx.page.offset, ctx.page.offset + ctx.page.pageSize), total: rows.length };
  });
  const resolve: Record<string, unknown> = { resolver };
  if (opts.pageSize) resolve.pagination = { pageSize: opts.pageSize };
  const store = new Palistor({
    config: { customers: defineList({ template, filter, resolve }) },
    ...(opts.initialData === undefined ? {} : { initialData: opts.initialData }),
  } as any) as any;
  return { store, list: store.proxy.customers, filter: store.proxy.customers.filter, calls, resolver };
}

/** A resolver-less list over CUSTOMERS (loaded rows: initialData is their baseline): only client fields act on it. */
function clientStore(filter: Record<string, unknown>) {
  const store = new Palistor({
    config: { customers: defineList({ template, filter }) },
    initialData: { customers: CUSTOMERS },
  } as any) as any;
  return { store, list: store.proxy.customers, filter: store.proxy.customers.filter };
}

async function loaded<T extends { list: any }>(s: T): Promise<T> {
  void s.list.items;
  await flush();
  return s;
}

// ─── typing in a manual field ────────────────────────────────────────────────

describe("typing in a manual field", () => {
  it("changes the field and filter.values, requests nothing, leaves the rows; isDraft turns true", async () => {
    const { list, filter, calls } = await loaded(serverStore({
      $apply: "manual",
      role: null as string | null,
      search: { value: "", where: byName },
    }));
    expect(calls).toHaveLength(1);
    expect(filter.isDraft).toBe(false);

    filter.role.value = "admin";
    filter.search.value = "al";
    await flush();
    expect(filter.role.value).toBe("admin");
    expect(filter.values).toEqual({ role: "admin", search: "al" });
    expect(calls).toHaveLength(1);
    expect(idsOf(list)).toEqual(["c1", "c2", "c3", "c4"]);
    expect(filter.isDraft).toBe(true);
  });

  it("does not move the list's state version or run a where predicate", async () => {
    const where = vi.fn(byName);
    const { store, list, filter } = clientStore({ $apply: "manual", search: { value: "", where } });
    void list.items;
    const version = store.getNodeVersion(list);
    const items = list.items;
    const calls = where.mock.calls.length;

    filter.search.value = "al";
    filter.search.value = "ali";
    expect(store.getNodeVersion(list)).toBe(version);
    expect(list.items).toBe(items);
    expect(where.mock.calls.length).toBe(calls);
  });
});

// ─── apply() ─────────────────────────────────────────────────────────────────

describe("apply()", () => {
  it("is one request with the applied values; isDraft is false again", async () => {
    const { list, filter, calls } = await loaded(serverStore({ $apply: "manual", role: null as string | null }));
    filter.role.value = "admin";
    await flush();
    expect(calls).toHaveLength(1);

    filter.apply();
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1].values).toEqual({ role: "admin" });
    expect(calls[1].params).toEqual({ role: "admin" });
    expect(idsOf(list)).toEqual(["c1", "c4"]);
    expect(filter.isDraft).toBe(false);
  });

  it("with nothing to apply: no request and no notification", async () => {
    const { store, filter, calls } = await loaded(serverStore({ $apply: "manual", role: null as string | null }));
    const cycle = store.getVersion();
    filter.apply();
    await flush();
    expect(calls).toHaveLength(1);
    expect(store.getVersion()).toBe(cycle);

    // Typed and typed back: the draft equals the applied value again.
    filter.role.value = "admin";
    filter.role.value = null;
    expect(filter.isDraft).toBe(false);
    const after = store.getVersion();
    filter.apply();
    await flush();
    expect(calls).toHaveLength(1);
    expect(store.getVersion()).toBe(after);
  });

  it("starts filtering rows by a client (where) manual field, in one notification", () => {
    const { store, list, filter } = clientStore({ $apply: "manual", search: { value: "", where: byName } });
    filter.search.value = "al";
    expect(idsOf(list)).toEqual(["c1", "c2", "c3", "c4"]);

    const cycle = store.getVersion();
    filter.apply();
    expect(store.getVersion()).toBe(cycle + 1);
    expect(idsOf(list)).toEqual(["c1", "c3"]);
    expect(list.length).toBe(2);
    expect(list.fullLength).toBe(4);
  });

  it("compares by content: a new array equal to the applied one is not a draft", async () => {
    const { store, filter, calls } = await loaded(serverStore({ $apply: "manual", roles: [] as string[] }));
    filter.roles.value = ["admin"];
    filter.apply();
    await flush();
    expect(calls).toHaveLength(2);

    filter.roles.value = ["admin"]; // another array, same content
    expect(filter.isDraft).toBe(false);
    const cycle = store.getVersion();
    filter.apply();
    await flush();
    expect(calls).toHaveLength(2);
    expect(store.getVersion()).toBe(cycle);
  });

  it("takes the formatted draft", async () => {
    const { filter, calls } = await loaded(serverStore({
      $apply: "manual",
      search: { value: "", formatter: (v: unknown) => String(v).trim() },
    }));
    filter.search.value = "  ali  ";
    expect(filter.search.value).toBe("ali");
    filter.apply();
    await flush();
    expect(calls[1].values).toEqual({ search: "ali" });
    expect(filter.applied).toEqual({ search: "ali" });
  });
});

// ─── revert() ────────────────────────────────────────────────────────────────

describe("revert()", () => {
  it("brings the fields back to the applied values and requests nothing", async () => {
    const { filter, calls } = await loaded(serverStore({ $apply: "manual", role: null as string | null, search: "" }));
    filter.set({ role: "user" });
    filter.apply();
    await flush();
    expect(calls).toHaveLength(2);

    filter.role.value = "admin";
    filter.search.value = "bo";
    expect(filter.isDraft).toBe(true);
    filter.revert();
    await flush();
    expect(filter.role.value).toBe("user");
    expect(filter.search.value).toBe("");
    expect(filter.values).toEqual({ role: "user", search: "" });
    expect(filter.isDraft).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it("with no draft: no notification", () => {
    const { store, filter } = clientStore({ $apply: "manual", search: { value: "", where: byName } });
    const cycle = store.getVersion();
    filter.revert();
    expect(store.getVersion()).toBe(cycle);
  });
});

// ─── what the list reads: the effective values ───────────────────────────────

describe("the effective values", () => {
  it("isActive / activeCount count the applied values; applied is the snapshot, values the drafts", () => {
    const { filter } = clientStore({
      $apply: "manual",
      search: { value: "", where: byName },
      role: { value: null as string | null, where: (row: any, role: string) => row.role === role },
    });
    filter.search.value = "al";
    filter.role.value = "user";
    expect(filter.isActive).toBe(false);
    expect(filter.activeCount).toBe(0);
    expect(filter.values).toEqual({ search: "al", role: "user" });
    expect(filter.applied).toEqual({ search: "", role: null });

    filter.apply();
    expect(filter.isActive).toBe(true);
    expect(filter.activeCount).toBe(2);
    expect(filter.applied).toEqual({ search: "al", role: "user" });

    filter.clear("role");
    expect(filter.activeCount).toBe(2);
    expect(filter.values).toEqual({ search: "al", role: null });
    expect(filter.applied).toEqual({ search: "al", role: "user" });
  });

  it("applied is one object per change", () => {
    const { filter } = clientStore({ $apply: "manual", search: { value: "", where: byName } });
    const before = filter.applied;
    filter.search.value = "al";
    expect(filter.applied).toBe(before);
    filter.apply();
    expect(filter.applied).not.toBe(before);
  });

  it("ctx.filter carries the applied values: values, params with param renames, the key", async () => {
    const { filter, calls } = await loaded(serverStore({
      $apply: "manual",
      role: { value: null as string | null, param: "role_id" },
      search: "",
    }));
    filter.role.value = "admin";
    filter.search.value = "car";
    filter.apply();
    await flush();
    expect(calls[1]).toEqual({
      values: { role: "admin", search: "car" },
      params: { role_id: "admin", search: "car" },
      key: '{"role":"admin","search":"car"}',
    });
  });

  it("$toParams receives the applied values", async () => {
    const toParams = vi.fn((values: Record<string, unknown>) => ({ q: values.search || undefined }));
    const { filter, calls } = await loaded(serverStore({ $apply: "manual", search: "", $toParams: toParams }));
    filter.search.value = "bo";
    filter.apply();
    await flush();
    expect(toParams).toHaveBeenLastCalledWith({ search: "bo" }, expect.anything());
    expect(calls[1].params).toEqual({ q: "bo" });
  });

  it("$all runs on the applied values", () => {
    const all = vi.fn((row: any, values: Record<string, unknown>) => !values.adminsOnly || row.role === "admin");
    // A client toggle whose rule lives in $all.
    const { list, filter } = clientStore({ $apply: "manual", adminsOnly: { value: false, where: () => true }, $all: all });
    filter.adminsOnly.value = true;
    expect(idsOf(list)).toEqual(["c1", "c2", "c3", "c4"]);
    filter.apply();
    expect(idsOf(list)).toEqual(["c1", "c4"]);
    expect(all).toHaveBeenLastCalledWith(expect.anything(), { adminsOnly: true });
  });

  it("a derived field: values computes it from the drafts, applied and the list from the applied values", async () => {
    const { list, filter, calls } = await loaded(serverStore({
      $apply: "manual",
      role: null as string | null,
      summary: { value: (v: Record<string, unknown>) => (v.role ? `role: ${v.role}` : "all"), where: (row: any, s: string) => s === "all" || s === `role: ${row.role}` },
    }));
    filter.role.value = "admin";
    expect(filter.summary.value).toBe("role: admin");
    expect(filter.values.summary).toBe("role: admin");
    expect(filter.applied.summary).toBe("all");
    expect(filter.activeCount).toBe(0); // a derived field never counts

    filter.apply();
    await flush();
    expect(filter.applied).toEqual({ role: "admin", summary: "role: admin" });
    expect(calls[1].values).toEqual({ role: "admin", summary: "role: admin" });
    expect(idsOf(list)).toEqual(["c1", "c4"]);
  });
});

// ─── set / reset / clear ─────────────────────────────────────────────────────

describe("set / reset / clear in manual mode", () => {
  it("set() writes the drafts and requests nothing; apply() sends them", async () => {
    const { filter, calls } = await loaded(serverStore({ $apply: "manual", role: null as string | null, search: "" }));
    filter.set({ role: "admin", search: "c" });
    await flush();
    expect(calls).toHaveLength(1);
    expect(filter.values).toEqual({ role: "admin", search: "c" });
    expect(filter.isDraft).toBe(true);
    filter.apply();
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1].values).toEqual({ role: "admin", search: "c" });
  });

  it("clear() writes the drafts; clear() + apply() is one request", async () => {
    const { filter, calls } = await loaded(serverStore({ $apply: "manual", role: null as string | null, search: "" }));
    filter.set({ role: "admin", search: "c" });
    filter.apply();
    await flush();
    expect(calls).toHaveLength(2);

    filter.clear();
    await flush();
    expect(calls).toHaveLength(2);
    expect(filter.values).toEqual({ role: null, search: "" });
    expect(filter.activeCount).toBe(2);
    expect(filter.isDraft).toBe(true);

    filter.clear();
    filter.apply();
    await flush();
    expect(calls).toHaveLength(3);
    expect(calls[2].values).toEqual({ role: null, search: "" });
    expect(filter.activeCount).toBe(0);
    expect(filter.isDraft).toBe(false);
  });

  it("reset() writes the declared defaults as drafts", async () => {
    const { filter, calls } = await loaded(serverStore({ $apply: "manual", role: "user", search: "" }));
    expect(calls[0].values).toEqual({ role: "user", search: "" });
    filter.set({ role: "admin" });
    filter.apply();
    await flush();
    filter.reset();
    await flush();
    expect(calls).toHaveLength(2);
    expect(filter.role.value).toBe("user");
    expect(filter.applied.role).toBe("admin");
    filter.apply();
    await flush();
    expect(calls).toHaveLength(3);
    expect(calls[2].values).toEqual({ role: "user", search: "" });
  });
});

// ─── mixed blocks ────────────────────────────────────────────────────────────

describe("a mixed block", () => {
  const mixed = () => serverStore({
    $apply: "manual",
    role: null as string | null,
    search: { value: "", apply: "auto", debounce: 30 },
  });

  it("an automatic field with debounce issues by itself, with the applied values of the manual fields", async () => {
    const { filter, calls } = await loaded(mixed());
    filter.role.value = "admin"; // draft
    filter.search.value = "a";
    expect(filter.isPending).toBe(true);
    await delay(50);
    await flush();
    expect(filter.isPending).toBe(false);
    expect(calls).toHaveLength(2);
    expect(calls[1].values).toEqual({ role: null, search: "a" });
    expect(filter.applied).toEqual({ role: null, search: "a" });
    expect(filter.isDraft).toBe(true);
  });

  it("apply() during a pending debounce: one request with both, the debounce stops", async () => {
    const { filter, calls } = await loaded(mixed());
    filter.search.value = "a";
    filter.role.value = "admin";
    expect(filter.isPending).toBe(true);
    filter.apply();
    expect(filter.isPending).toBe(false);
    await delay(50);
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1].values).toEqual({ role: "admin", search: "a" });
  });

  it("revert() leaves a pending debounce alone", async () => {
    const { filter, calls } = await loaded(mixed());
    filter.search.value = "a";
    filter.role.value = "admin";
    filter.revert();
    expect(filter.role.value).toBe(null);
    expect(filter.search.value).toBe("a");
    expect(filter.isPending).toBe(true);
    await delay(50);
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1].values).toEqual({ role: null, search: "a" });
  });

  it("set() on both: the automatic field issues at once, the manual one stays a draft", async () => {
    const { filter, calls } = await loaded(mixed());
    filter.set({ role: "admin", search: "a" });
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1].values).toEqual({ role: null, search: "a" });
    expect(filter.isDraft).toBe(true);
  });

  it("apply: \"manual\" on one field of an automatic block", async () => {
    const { filter, calls } = await loaded(serverStore({ search: "", role: { value: null as string | null, apply: "manual" } }));
    filter.search.value = "a";
    await flush();
    expect(calls).toHaveLength(2);
    filter.role.value = "admin";
    await flush();
    expect(calls).toHaveLength(2);
    expect(filter.isDraft).toBe(true);
    filter.apply();
    await flush();
    expect(calls).toHaveLength(3);
    expect(calls[2].values).toEqual({ search: "a", role: "admin" });
  });
});

// ─── paginated lists ─────────────────────────────────────────────────────────

describe("a paginated list", () => {
  it("apply() goes back to the first page with one request; a draft keystroke keeps the page", async () => {
    const { list, filter, calls } = await loaded(serverStore({ $apply: "manual", role: null as string | null }, { pageSize: 2 }));
    expect(calls).toEqual([{ values: { role: null }, params: { role: null }, key: '{"role":null}', page: 1 }]);
    list.nextPage();
    await flush();
    expect(list.page).toBe(2);
    expect(calls).toHaveLength(2);

    filter.role.value = "user";
    await flush();
    expect(list.page).toBe(2);
    expect(calls).toHaveLength(2);

    filter.apply();
    await flush();
    expect(calls).toHaveLength(3);
    expect(calls[2]).toMatchObject({ values: { role: "user" }, page: 1 });
    expect(list.page).toBe(1);
    expect(idsOf(list)).toEqual(["c2", "c3"]);
    expect(list.total).toBe(2);
  });

  it("with initialData nothing is requested until apply()", async () => {
    const { list, filter, calls } = serverStore(
      { $apply: "manual", role: null as string | null, search: { value: "", where: byName } },
      { pageSize: 2, initialData: { customers: { items: CUSTOMERS.slice(0, 2), total: 4 } } },
    );
    expect(idsOf(list)).toEqual(["c1", "c2"]);
    await flush();
    filter.role.value = "admin";
    filter.search.value = "b";
    await flush();
    expect(calls).toEqual([]);
    expect(idsOf(list)).toEqual(["c1", "c2"]);

    filter.apply();
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ values: { role: "admin", search: "b" }, page: 1 });
  });

  it("not paginated, with initialData: nothing is requested until apply()", async () => {
    const { list, filter, calls } = serverStore(
      { $apply: "manual", role: null as string | null },
      { initialData: { customers: CUSTOMERS } },
    );
    expect(list.resolveStatus).toBe("resolved");
    filter.role.value = "admin";
    await flush();
    expect(calls).toEqual([]);
    filter.apply();
    await flush();
    expect(calls).toHaveLength(1);
    expect(idsOf(list)).toEqual(["c1", "c4"]);
  });
});

// ─── construction errors ─────────────────────────────────────────────────────

describe("dead or invalid apply config throws at construction", () => {
  const build = (filter: Record<string, unknown>) => () =>
    new Palistor({ config: { customers: defineList({ template, filter, resolve: { resolver: async () => [] } }) } });

  it("debounce on a manual field", () => {
    expect(build({ $apply: "manual", q: { value: "", debounce: 300 } })).toThrow(
      /filter field "q" on list "customers" follows the block's \$apply: "manual" and "debounce"/,
    );
    expect(build({ q: { value: "", apply: "manual", debounce: 300 } })).toThrow(/declares apply: "manual" and "debounce"/);
  });

  it.each(["apply", "revert", "isDraft", "applied"])("a field named %s", (name) => {
    expect(build({ [name]: "" })).toThrow(/collides with a built-in member of list.filter/);
  });

  it("an invalid $apply or apply value", () => {
    expect(build({ $apply: "manually", q: "" })).toThrow(/filter "\$apply" on list "customers" must be "manual" or "auto"/);
    expect(build({ q: { value: "", apply: true } })).toThrow(/filter field "q" on list "customers": "apply" must be "auto" or "manual"/);
  });

  it("apply on a derived field", () => {
    expect(build({ q: "", label: { value: (v: Record<string, unknown>) => String(v.q), apply: "manual" } })).toThrow(
      /derived filter field "label" on list "customers" declares "apply"/,
    );
  });

  it("$apply: \"manual\" that reaches no field", () => {
    expect(build({ $apply: "manual", q: { value: "", apply: "auto" } })).toThrow(/\$apply": "manual" on list "customers" reaches no field/);
    expect(build({ $apply: "manual" })).toThrow(/reaches no field/);
  });

  it("accepts $apply: \"auto\" and redundant per-field modes", () => {
    expect(build({ $apply: "auto", q: { value: "", apply: "auto" } })).not.toThrow();
    expect(build({ $apply: "manual", q: { value: "", apply: "manual" }, r: { value: "", apply: "auto", debounce: 10 } })).not.toThrow();
  });
});

// ─── automatic mode ──────────────────────────────────────────────────────────

describe("automatic mode (no $apply)", () => {
  it("apply() and revert() are no-ops, isDraft is false, applied equals values", async () => {
    const { store, filter, calls } = await loaded(serverStore({ role: null as string | null, search: { value: "", where: byName } }));
    filter.role.value = "admin";
    await flush();
    expect(calls).toHaveLength(2);
    expect(filter.isDraft).toBe(false);
    expect(filter.applied).toEqual(filter.values);
    expect(filter.applied).toBe(filter.values);

    const cycle = store.getVersion();
    filter.apply();
    filter.revert();
    await flush();
    expect(store.getVersion()).toBe(cycle);
    expect(calls).toHaveLength(2);
    expect(filter.role.value).toBe("admin");
  });

  it("the spread keys stay the fields and the seven builtins; the apply members are off the spread", () => {
    for (const block of [{ search: "" }, { $apply: "manual", search: "" }]) {
      const { filter } = clientStore(block);
      expect(Object.keys(filter)).toEqual(["search", "values", "set", "reset", "clear", "isActive", "activeCount", "isPending"]);
      expect(typeof filter.apply).toBe("function");
      expect(typeof filter.revert).toBe("function");
      expect(filter.apply).toBe(filter.apply);
      expect("isDraft" in filter && "applied" in filter).toBe(true);
      expect(() => { filter.isDraft = true; }).toThrow(/cannot assign to list.filter.isDraft/);
    }
  });
});
