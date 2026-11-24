/**
 * List sorting through React (experiments/SortPlan.md, Stage 1): the plan's
 * own example — a table whose headers get `list.sort` as a prop and call
 * `useForm(sort)` — and who re-renders when. A header follows the sort
 * state, the table follows the order, a row follows its own values only.
 * The type-level block at the end is checked by `npm run typecheck:cube`.
 */
import { memo, type ReactNode } from "react";
import { describe, it, expect } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import {
  Palistor,
  defineList,
  useForm,
  type ListResolveContext,
  type PalistorList,
  type PalistorRef,
  type SortBlock,
  type SortKey,
  type SortProxyNode,
} from "../index";

type Product = { id: string; title: string; price: number; category: string; inStock: boolean; rating: number | null };
type ProductKey = keyof Product & string;

const template = {
  id: { value: "" }, title: { value: "" }, price: { value: 0 },
  category: { value: "" }, inStock: { value: true }, rating: { value: null as number | null },
};

const PRODUCTS: Product[] = [
  { id: "p1", title: "Desk", price: 30, category: "b", inStock: true, rating: 4 },
  { id: "p2", title: "Lamp", price: 10, category: "a", inStock: false, rating: null },
  { id: "p3", title: "Shelf", price: 20, category: "b", inStock: true, rating: 5 },
];

/** The plan's components, counting their renders by name. */
function table() {
  const renders: Record<string, number> = {};
  const count = (name: string) => { renders[name] = (renders[name] ?? 0) + 1; };

  function SortHeader({ sort, column, children }: { sort: SortProxyNode<ProductKey>; column: ProductKey; children: ReactNode }) {
    count(`header:${column}`);
    const state = useForm(sort); // its own subscription: the headers re-render when the sort changes
    const dir = state.dirOf(column);
    return (
      <th aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"} data-column={column}>
        <button onClick={() => state.toggle(column)}>
          {children}{dir === "asc" ? " ▲" : dir === "desc" ? " ▼" : ""}
        </button>
      </th>
    );
  }

  // memo: a re-rendering table re-renders a plain child component anyway (React). The row node a
  // table hands down is the same object from render to render, so memo keeps the row out of it.
  const ProductRow = memo(function ProductRow({ product }: { product: PalistorRef<Product> }) {
    const row = useForm(product);
    count(`row:${row.id}`);
    return <tr data-id={row.id}><td>{row.title.value}</td><td>{row.price.value}</td></tr>;
  });

  function ProductsTable({ products }: { products: PalistorList<Product> }) {
    count("table");
    const list = useForm(products);
    const sort = list.sort!; // like `filter`: optional in the type, present on a list with the block
    return (
      <table>
        <thead>
          <tr>
            <SortHeader sort={sort} column="title">Title</SortHeader>
            <SortHeader sort={sort} column="price">Price</SortHeader>
          </tr>
        </thead>
        <tbody>{list.map((row, _index, id) => <ProductRow key={id} product={row} />)}</tbody>
      </table>
    );
  }

  const store = new Palistor({ config: { products: defineList<Product>({ template, sort: true }) } });
  store.set(PRODUCTS);
  store.proxy.products.setItems(PRODUCTS.map((p) => p.id));

  function Root() {
    const form = useForm(store);
    return <ProductsTable products={form.products} />;
  }
  return { Root, renders, store };
}

const rowIds = (container: HTMLElement) => [...container.querySelectorAll("tbody tr")].map((tr) => tr.getAttribute("data-id"));
const header = (container: HTMLElement, column: string) => container.querySelector(`th[data-column="${column}"]`)!;
const diff = (after: Record<string, number>, before: Record<string, number>) =>
  Object.fromEntries(Object.entries(after).filter(([k, v]) => v !== (before[k] ?? 0)).map(([k, v]) => [k, v - (before[k] ?? 0)]));

describe("a sortable table: who re-renders", () => {
  it("a header press re-orders the rows: the headers and the table re-render, no row does", () => {
    const { Root, renders } = table();
    const { container } = render(<Root />);
    expect(rowIds(container)).toEqual(["p1", "p2", "p3"]);
    const before = { ...renders };

    fireEvent.click(header(container, "price").querySelector("button")!);
    expect(rowIds(container)).toEqual(["p2", "p3", "p1"]);
    expect(header(container, "price").getAttribute("aria-sort")).toBe("ascending");
    expect(header(container, "price").textContent).toBe("Price ▲");
    expect(header(container, "title").getAttribute("aria-sort")).toBe("none");
    expect(diff(renders, before)).toEqual({ table: 1, "header:title": 1, "header:price": 1 });

    fireEvent.click(header(container, "price").querySelector("button")!);
    expect(rowIds(container)).toEqual(["p1", "p3", "p2"]);
    expect(header(container, "price").getAttribute("aria-sort")).toBe("descending");

    fireEvent.click(header(container, "price").querySelector("button")!); // third press: the list's own order
    expect(rowIds(container)).toEqual(["p1", "p2", "p3"]);
    expect(header(container, "price").getAttribute("aria-sort")).toBe("none");
  });

  it("a sort change that leaves the order as it was re-renders the headers only", () => {
    const { Root, renders } = table();
    const { container } = render(<Root />);
    const before = { ...renders };
    fireEvent.click(header(container, "title").querySelector("button")!); // Desk, Lamp, Shelf: already in title order
    expect(rowIds(container)).toEqual(["p1", "p2", "p3"]);
    expect(header(container, "title").getAttribute("aria-sort")).toBe("ascending");
    expect(diff(renders, before)).toEqual({ "header:title": 1, "header:price": 1 });
  });

  it("a value edit in the sorted column re-renders that row only, in place; refresh() moves it and re-renders the table, no row", () => {
    const { Root, renders, store } = table();
    const { container } = render(<Root />);
    fireEvent.click(header(container, "price").querySelector("button")!);
    expect(rowIds(container)).toEqual(["p2", "p3", "p1"]);

    let before = { ...renders };
    act(() => { store.set({ id: "p2", price: 99 }); });
    expect(rowIds(container)).toEqual(["p2", "p3", "p1"]);
    expect(container.querySelector('tr[data-id="p2"]')!.textContent).toBe("Lamp99");
    expect(diff(renders, before)).toEqual({ "row:p2": 1 });

    before = { ...renders };
    act(() => { store.proxy.products.sort!.refresh(); });
    expect(rowIds(container)).toEqual(["p3", "p1", "p2"]);
    expect(diff(renders, before)).toEqual({ table: 1, "header:title": 1, "header:price": 1 }); // the headers as the table's plain children
  });

  it("an added row goes to the end of a sorted table", () => {
    const { Root, store } = table();
    const { container } = render(<Root />);
    fireEvent.click(header(container, "price").querySelector("button")!);
    act(() => { store.proxy.products.add({ id: "p4", title: "Chair", price: 5, category: "a", inStock: true, rating: 2 }); });
    expect(rowIds(container)).toEqual(["p2", "p3", "p1", "p4"]);
    fireEvent.click(header(container, "price").querySelector("button")!); // desc: ordered again
    expect(rowIds(container)).toEqual(["p1", "p3", "p2", "p4"]);
  });

  it("the sort read straight through the list's useForm is tracked there too", () => {
    const store = new Palistor({ config: { products: defineList<Product>({ template, sort: true }) } });
    let renders = 0;
    function Status() {
      const form = useForm(store);
      renders++;
      return <span>{form.products.sort!.key ?? "none"}</span>;
    }
    const { container } = render(<Status />);
    expect(container.textContent).toBe("none");
    act(() => { store.proxy.products.sort!.set("price"); });
    expect(container.textContent).toBe("price");
    expect(renders).toBe(2);
    act(() => { store.proxy.products.sort!.set("price"); }); // the same state: no re-render
    expect(renders).toBe(2);
  });

  it("a raw list.sort from store.proxy is refused, like any raw node", () => {
    const store = new Palistor({ config: { products: defineList<Product>({ template, sort: true }) } });
    function Bad() {
      useForm(store.proxy.products.sort!);
      return null;
    }
    const error = console.error;
    console.error = () => {};
    try {
      expect(() => render(<Bad />)).toThrow("useForm: received a raw store proxy node");
    } finally {
      console.error = error;
    }
  });
});

// ─── Types ────────────────────────────────────────────────────────────────────
// Checked by `npm run typecheck:cube`; never called.

declare const api: { products(): Promise<Product[]> };
type Order = { id: string; title: string; amount: number; createdAt: string; lastName: string; firstName: string; priority: "low" | "high" };
declare const db: {
  from(table: string): {
    select(columns: string, opts: { count: "exact" }): Query;
  };
};
interface Query {
  order(column: string, opts: { ascending: boolean }): Query;
  range(from: number, to: number): Promise<{ data: Order[] | null; count: number | null }>;
}

/** React Aria / HeroUI `Table` props, as their types declare them. */
declare function Table(props: {
  sortDescriptor?: { column: string | number; direction: "ascending" | "descending" };
  onSortChange?: (descriptor: { column: string | number; direction: "ascending" | "descending" }) => unknown;
  children?: ReactNode;
}): ReactNode;

function TypeLevel({ products, sort, loose }: { products: PalistorList<Product>; sort: SortProxyNode<ProductKey>; loose: SortProxyNode }): null {
  // ── The plan's base case: `sort: true`, list.sort into a SortProxyNode<ProductKey> prop, useForm on it.
  const config = {
    products: defineList<Product>({ template, sort: true, resolve: { resolver: async () => api.products() } }),
  };
  void config;
  const list = useForm(products);
  const fromList: SortProxyNode<ProductKey> = list.sort!;
  const untyped: SortProxyNode = list.sort!;
  const state = useForm(sort);
  const dir: "asc" | "desc" | null = state.dirOf("price");
  const key: ProductKey | null = state.key;
  const keys: readonly ProductKey[] = state.keys;
  const first: { readonly key: ProductKey; readonly dir: "asc" | "desc" } | undefined = state.by[0];
  state.toggle("title");
  state.set("price", "desc");
  state.clear();
  state.reset();
  state.refresh();
  // @ts-expect-error not a key of Product
  state.toggle("nope");
  // @ts-expect-error not a direction
  state.set("price", "up");
  const generic = useForm(loose);
  generic.toggle("anything");

  // ── HeroUI / React Aria.
  void Table({ sortDescriptor: state.sortDescriptor, onSortChange: state.onSortChange });
  const column: ProductKey | undefined = state.sortDescriptor?.column;

  // ── The block: keys of the entity, `by` / `compare` get the row typed without annotations.
  const orders = defineList<Order>({
    template: {
      id: { value: "" }, title: { value: "" }, amount: { value: 0 }, createdAt: { value: "" },
      lastName: { value: "" }, firstName: { value: "" }, priority: { value: "low" },
    },
    sort: {
      $default: "-createdAt",
      title: true,
      lastName: { by: (row) => `${row.lastName} ${row.firstName}` },
      priority: { compare: (a, b) => (a.priority === b.priority ? 0 : a.priority === "high" ? 1 : -1) },
    },
  });
  void orders;
  // @ts-expect-error not a key of Product
  defineList<Product>({ template, sort: { nope: true } });
  // @ts-expect-error $default by a key that is not one
  defineList<Product>({ template, sort: { $default: "-nope" } });
  // @ts-expect-error `by` returns a value, `compare` an order: a field takes one of them
  defineList<Product>({ template, sort: { price: { by: (row) => row.price, compare: () => 0 } } });

  // ── A leaf in a nested group is a dotted path; the group itself is not a key, nor is a nested list.
  type Customer = { id: string; name: string; address: { city: string; zip?: number }; tags: { id: string }[] };
  const customerKeys: SortKey<Customer>[] = ["id", "name", "address.city", "address.zip"];
  const nested: SortBlock<Customer> = { $default: "address.city", "address.city": true };
  // @ts-expect-error a group is not a leaf
  const group: SortBlock<Customer> = { address: true };
  // @ts-expect-error a nested list is not a leaf
  const nestedList: SortKey<Customer> = "tags";

  // ── ctx.sort: always there, typed without annotations, and with the plan's annotation.
  defineList<Product>({
    template,
    sort: true,
    resolve: {
      resolver: async (_values, _store, ctx) => {
        const by: Array<{ key: string; param: string; dir: "asc" | "desc" }> = ctx.sort.by;
        const requestKey: string = ctx.sort.key;
        void [by, requestKey];
        return api.products();
      },
    },
  });
  const serverOrders = defineList<Order>({
    template: {
      id: { value: "" }, title: { value: "" }, amount: { value: 0 }, createdAt: { value: "" },
      lastName: { value: "" }, firstName: { value: "" }, priority: { value: "low" },
    },
    sort: { $default: "-createdAt", title: true, amount: true, createdAt: { param: "created_at" } },
    resolve: {
      pagination: { pageSize: 20 },
      resolver: async (_values: unknown, _store: unknown, ctx: ListResolveContext) => {
        let query = db.from("orders").select("*", { count: "exact" });
        for (const s of ctx.sort.by) query = query.order(s.param, { ascending: s.dir === "asc" });
        const { data, count } = await query.range(ctx.page!.offset, ctx.page!.offset + ctx.page!.pageSize - 1);
        return { items: data ?? [], total: count ?? 0 };
      },
    },
  });
  void serverOrders;

  void [fromList, untyped, dir, key, keys, first, column, customerKeys, nested, group, nestedList];
  return null;
}
void TypeLevel;
