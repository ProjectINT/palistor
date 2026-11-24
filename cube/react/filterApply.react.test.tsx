/**
 * The filter's apply mode through useForm (SortPlan.md decision 14, Stage 3),
 * Cube only. The core rules are in cube/core/filterApply.test.ts; here:
 *
 * - the plan's usage example ("Режим «Применить»"), typed as written: the
 *   block with `$apply`, a panel on `useForm(props.filter)` with Apply and
 *   Cancel buttons and the applied-filter badge;
 * - a component reading only the rows does not re-render on a draft
 *   keystroke, and does when apply() changes them;
 * - a component reading `isDraft` / `applied` re-renders when they change.
 */
import { describe, it, expect } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  Palistor,
  defineList,
  useForm,
  type FieldProxyNode,
  type FilterFieldConfig,
  type FilterProxyNode,
  type ListResolveContext,
  type PalistorList,
} from "../index";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

type Role = "admin" | "user";
interface Customer { id: string; name: string; role: string }

const ROLES: Role[] = ["admin", "user"];
const ALL: Customer[] = [
  { id: "c1", name: "Alice", role: "admin" },
  { id: "c2", name: "Bob", role: "user" },
  { id: "c3", name: "Alina", role: "user" },
  { id: "c4", name: "Carl", role: "admin" },
];

// ─── the plan's example ──────────────────────────────────────────────────────

/** The block from the plan, as written; the resolver records what each request carried. */
function customersStore() {
  const requests: Array<ListResolveContext["filter"]> = [];
  const loadCustomers = async (_values: unknown, _store: unknown, ctx: ListResolveContext) => {
    requests.push(ctx.filter);
    const { search, role } = ctx.filter.values as { search: string; role: Role | null };
    const rows = ALL.filter((c) => (!role || c.role === role) && c.name.toLowerCase().includes(search.toLowerCase()));
    const page = ctx.page!;
    return { items: rows.slice(page.offset, page.offset + page.pageSize), total: rows.length };
  };

  const customers = defineList<Customer>({
    template: { id: { value: "" }, name: { value: "" }, role: { value: "" } },
    filter: {
      $apply: "manual",                                   // the block's fields are a draft
      search: "",
      role: { value: null as Role | null, param: "role_id" },
      quick: { value: "", apply: "auto", debounce: 300 }, // the exception: applied as it changes
    },
    resolve: { pagination: { pageSize: 20 }, resolver: loadCustomers },
  });
  return { store: new Palistor({ config: { customers } }), requests };
}

function TextField({ field }: { field: FieldProxyNode<string> }) {
  const f = useForm(field);
  return <input aria-label="search" value={f.value} onChange={(event) => f.onValueChange(event.target.value)} />;
}

function SelectField({ field, options }: { field: FieldProxyNode<Role | null>; options: Role[] }) {
  const f = useForm(field);
  return (
    <select aria-label="role" value={f.value ?? ""} onChange={(event) => f.onValueChange((event.target.value || null) as Role | null)}>
      <option value="">any</option>
      {options.map((role) => <option key={role} value={role}>{role}</option>)}
    </select>
  );
}

function FilterPanel({ filter }: { filter: FilterProxyNode }) {
  const f = useForm(filter);
  return (
    <form onSubmit={(event) => { event.preventDefault(); f.apply(); }}>
      <TextField field={f.search} />                       {/* shows the draft */}
      <SelectField field={f.role} options={ROLES} />
      <button type="submit" disabled={!f.isDraft}>Apply</button>
      <button type="button" onClick={() => f.revert()}>Cancel</button>
      {f.isActive && <span data-testid="badge">Filters: {f.activeCount}</span>} {/* counts the applied ones */}
    </form>
  );
}

const renders: Record<string, number> = {};
const count = (id: string) => { renders[id] = (renders[id] ?? 0) + 1; };

function Rows({ list }: { list: PalistorList<Customer> }) {
  count("rows");
  const l = useForm(list);
  return <ul data-testid="rows">{l.map((_row, _index, id) => <li key={id}>{id}</li>)}</ul>;
}

const rowIds = () => Array.from(screen.getByTestId("rows").children).map((li) => li.textContent);
const applyButton = () => screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement;

describe("the plan's filter panel", () => {
  it("a draft enables Apply and touches neither the rows nor the server; Apply is one request; Cancel reverts", async () => {
    const { store, requests } = customersStore();
    function Customers() {
      const form = useForm(store);
      const list = form.customers;
      return <><FilterPanel filter={list.filter!} /><Rows list={list} /></>;
    }
    render(<Customers />);
    await act(flush);
    expect(requests).toHaveLength(1);
    expect(rowIds()).toEqual(["c1", "c2", "c3", "c4"]);
    expect(applyButton().disabled).toBe(true);

    await act(async () => {
      fireEvent.change(screen.getByLabelText("search"), { target: { value: "al" } });
      fireEvent.change(screen.getByLabelText("role"), { target: { value: "user" } });
      await flush();
    });
    expect((screen.getByLabelText("search") as HTMLInputElement).value).toBe("al");
    expect(applyButton().disabled).toBe(false);
    expect(screen.queryByTestId("badge")).toBeNull();
    expect(rowIds()).toEqual(["c1", "c2", "c3", "c4"]);
    expect(requests).toHaveLength(1);

    await act(async () => {
      fireEvent.click(applyButton());
      await flush();
    });
    expect(requests).toHaveLength(2);
    expect(requests[1].values).toEqual({ search: "al", role: "user", quick: "" });
    expect(requests[1].params).toEqual({ search: "al", role_id: "user", quick: "" });
    expect(rowIds()).toEqual(["c3"]);
    expect(applyButton().disabled).toBe(true);
    expect(screen.getByTestId("badge").textContent).toBe("Filters: 2");

    await act(async () => {
      fireEvent.change(screen.getByLabelText("search"), { target: { value: "bo" } });
      await flush();
    });
    expect(applyButton().disabled).toBe(false);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await flush();
    });
    expect((screen.getByLabelText("search") as HTMLInputElement).value).toBe("al");
    expect(applyButton().disabled).toBe(true);
    expect(requests).toHaveLength(2);
  });
});

describe("the apply-mode types", () => {
  it("$apply and a field's apply take only their two modes", () => {
    const build = (filter: Parameters<typeof defineList<Customer>>[0]["filter"]) => () =>
      new Palistor({ config: { customers: defineList<Customer>({ template: { id: { value: "" }, name: { value: "" }, role: { value: "" } }, filter }) } });
    // @ts-expect-error — not a mode
    expect(build({ $apply: "manually", search: "" })).toThrow(/must be "manual" or "auto"/);

    const field: FilterFieldConfig<Customer> = { value: "", apply: "manual" };
    // @ts-expect-error — not a mode
    const wrong: FilterFieldConfig<Customer> = { value: "", apply: "later" };
    expect(build({ $apply: "auto", search: field })).not.toThrow();
    expect(build({ search: wrong })).toThrow(/"apply" must be "auto" or "manual"/);
  });

  it("list.filter declares apply, revert, isDraft and applied", () => {
    const { store } = customersStore();
    const filter: FilterProxyNode = store.proxy.customers.filter!;
    const apply: () => void = filter.apply;
    const revert: () => void = filter.revert;
    const isDraft: boolean = filter.isDraft;
    const applied: Record<string, unknown> = filter.applied;
    expect([typeof apply, typeof revert, isDraft, applied]).toEqual(["function", "function", false, { search: "", role: null, quick: "" }]);
  });
});

// ─── render precision ────────────────────────────────────────────────────────

describe("apply mode + useForm precision", () => {
  /** A resolver-less list with manual client fields (the panel's two); the rows come as initialData (their baseline). */
  function clientStore() {
    return new Palistor({
      config: {
        customers: defineList<Customer>({
          template: { id: { value: "" }, name: { value: "" }, role: { value: "" } },
          filter: {
            $apply: "manual",
            search: { value: "", where: (row: Customer, q: string) => row.name.toLowerCase().includes(q.toLowerCase()) },
            role: { value: null as Role | null, where: (row: Customer, role: Role) => row.role === role },
          },
        }),
      },
      initialData: { customers: ALL },
    });
  }

  it("a rows component ignores a draft keystroke and follows apply()", async () => {
    const store = clientStore();
    function Customers() {
      count("root");
      const form = useForm(store);
      const list = form.customers;
      return <><FilterPanel filter={list.filter!} /><Rows list={list} /></>;
    }
    for (const k of Object.keys(renders)) delete renders[k];
    render(<Customers />);
    expect(rowIds()).toEqual(["c1", "c2", "c3", "c4"]);
    const rows = renders.rows;

    await act(async () => {
      fireEvent.change(screen.getByLabelText("search"), { target: { value: "al" } });
      fireEvent.change(screen.getByLabelText("search"), { target: { value: "ali" } });
      await flush();
    });
    expect(applyButton().disabled).toBe(false);
    expect(renders.rows).toBe(rows);
    expect(rowIds()).toEqual(["c1", "c2", "c3", "c4"]);

    await act(async () => {
      fireEvent.click(applyButton());
      await flush();
    });
    expect(renders.rows).toBeGreaterThan(rows);
    expect(rowIds()).toEqual(["c1", "c3"]);
    expect(renders.root).toBe(1);
  });

  it("a component reading isDraft and applied through useForm(props.filter) re-renders when they change", async () => {
    const store = clientStore();
    let reads = 0;
    function State({ filter }: { filter: FilterProxyNode }) {
      reads++;
      const f = useForm(filter);
      return <p data-testid="state">{f.isDraft ? "draft" : "clean"} {JSON.stringify(f.applied)}</p>;
    }
    function Customers() {
      const form = useForm(store);
      return <State filter={form.customers.filter!} />;
    }
    render(<Customers />);
    const state = () => screen.getByTestId("state").textContent;
    expect(state()).toBe('clean {"search":"","role":null}');

    const filter = store.proxy.customers.filter!;
    await act(async () => { filter.search.value = "al"; await flush(); });
    expect(state()).toBe('draft {"search":"","role":null}');

    const before = reads;
    await act(async () => { filter.apply(); await flush(); });
    expect(reads).toBeGreaterThan(before);
    expect(state()).toBe('clean {"search":"al","role":null}');

    await act(async () => { filter.search.value = "bo"; filter.revert(); await flush(); });
    expect(state()).toBe('clean {"search":"al","role":null}');
  });
});
