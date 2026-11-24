/**
 * List sorting, Stage 1 of experiments/SortPlan.md (Cube only): the client
 * sort of a list that holds all its rows. The block and its construction
 * errors, the default comparison, the order as a snapshot, the projection
 * over the client filter, `list.sort` and `ctx.sort`.
 */
import { describe, it, expect, vi } from "vitest";
import { Palistor, defineFieldMapping, defineList, type ListResolveContext, type SortBlock } from "../index";
import { compareValues } from "./sort";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

type Product = { id: string; title: string; price: number; category: string; inStock: boolean; rating: number | null };

const template = {
  id: { value: "" }, title: { value: "" }, price: { value: 0 },
  category: { value: "" }, inStock: { value: true }, rating: { value: null as number | null },
};

/** Membership order p1..p4; prices 30 / 10 / 20 / 10 (a tie), p2 without a rating. */
const PRODUCTS: Product[] = [
  { id: "p1", title: "Товар 10", price: 30, category: "b", inStock: true, rating: 4 },
  { id: "p2", title: "товар 2", price: 10, category: "a", inStock: false, rating: null },
  { id: "p3", title: "Товар 1", price: 20, category: "b", inStock: true, rating: 5 },
  { id: "p4", title: "Apple", price: 10, category: "a", inStock: false, rating: 3 },
];

const ids = (list: { items: ReadonlyArray<unknown> }) => (list.items as any[]).map((item) => item.id as string);

/** A list without a resolver, loaded through setItems (a recompute moment, like a resolve landing). */
function products(sort: SortBlock<Product> = true, rows: Product[] = PRODUCTS) {
  const store = new Palistor({ config: { products: defineList<Product>({ template, sort }) } });
  const list = store.proxy.products;
  store.set(rows);
  list.setItems(rows.map((r) => r.id));
  return { store, list, sort: list.sort! };
}

// ─── The default comparison (decisions 4–6) ──────────────────────────────────

describe("comparison by value", () => {
  it("numbers as numbers; ties keep the list's order in both directions (desc negates the comparison, it does not reverse the array)", () => {
    const { list, sort } = products();
    sort.set("price");
    expect(ids(list)).toEqual(["p2", "p4", "p3", "p1"]);
    sort.set("price", "desc");
    expect(ids(list)).toEqual(["p1", "p3", "p2", "p4"]);
  });

  it("strings by locale: \"2\" before \"10\", case and accents ignored", () => {
    const { list, sort } = products();
    sort.set("title");
    expect(ids(list)).toEqual(["p4", "p3", "p2", "p1"]); // Apple, Товар 1, товар 2, Товар 10

    const words = products({ title: true }, [
      { ...PRODUCTS[0], id: "w1", title: "b" },
      { ...PRODUCTS[0], id: "w2", title: "A" },
      { ...PRODUCTS[0], id: "w3", title: "á" },
      { ...PRODUCTS[0], id: "w4", title: "B" },
    ]);
    words.sort.set("title");
    expect(ids(words.list)).toEqual(["w2", "w3", "w1", "w4"]); // A = á, b = B: ties in list order
  });

  it("booleans: false before true", () => {
    const { list, sort } = products();
    sort.set("inStock");
    expect(ids(list)).toEqual(["p2", "p4", "p1", "p3"]);
    sort.set("inStock", "desc");
    expect(ids(list)).toEqual(["p1", "p3", "p2", "p4"]);
  });

  // A Date object in a row does not survive the registry (it is stored as a nested group, as in store):
  // a date leaf holds an ISO string or a timestamp, and `by` turns it into a Date where that matters.
  it("dates by time: a `by` that returns a Date, and ISO strings stored in the row", () => {
    type Event = { id: string; at: string; day: string };
    const store = new Palistor({
      config: {
        events: defineList<Event>({
          template: { id: { value: "" }, at: { value: "" }, day: { value: "" } },
          sort: { at: true, day: { by: (row) => new Date(row.day) } },
        }),
      },
    });
    const list = store.proxy.events;
    const rows = [
      { id: "e1", at: "2026-11-02T10:00:00.000Z", day: "Mon, 02 Nov 2026 10:00:00 GMT" },
      { id: "e2", at: "2025-01-15T10:00:00.000Z", day: "Wed, 15 Jan 2025 10:00:00 GMT" },
      { id: "e3", at: "2026-02-09T08:30:00.000Z", day: "Mon, 09 Feb 2026 08:30:00 GMT" },
    ];
    store.set(rows);
    list.setItems(rows.map((r) => r.id));
    list.sort!.set("day");
    expect(ids(list)).toEqual(["e2", "e3", "e1"]);
    list.sort!.set("at", "desc");
    expect(ids(list)).toEqual(["e1", "e3", "e2"]);
  });

  it("compareValues: Date objects by time, mixed types as text", () => {
    const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
    expect(compareValues(new Date(2020, 0, 2), new Date(2020, 0, 1), collator)).toBeGreaterThan(0);
    expect(compareValues(10, "9", collator)).toBeGreaterThan(0); // "10" after "9"
    expect(compareValues("abc", 10, collator)).toBeGreaterThan(0);
    expect(compareValues(false, true, collator)).toBeLessThan(0);
  });

  it("values of different types compare as text", () => {
    type Row = { id: string; code: unknown };
    const store = new Palistor({ config: { rows: defineList<Row>({ template: { id: { value: "" }, code: { value: "" } }, sort: true }) } });
    const list = store.proxy.rows;
    const rows = [{ id: "a", code: "abc" }, { id: "b", code: 10 }, { id: "c", code: "9" }];
    store.set(rows);
    list.setItems(rows.map((r) => r.id));
    list.sort!.set("code");
    expect(ids(list)).toEqual(["c", "b", "a"]);
  });

  it("empty values — null, undefined, \"\" and a missing key — go last in both directions", () => {
    const rows = [
      ...PRODUCTS,
      { id: "p5", title: "", price: 5, category: "c", inStock: true, rating: undefined as unknown as null },
      { id: "p6", title: "Zed", price: 6, category: "c", inStock: true } as Product, // no rating: reads the template default
    ];
    const { list, sort } = products(true, rows);
    sort.set("rating");
    expect(ids(list)).toEqual(["p4", "p1", "p3", "p2", "p5", "p6"]);
    sort.set("rating", "desc");
    expect(ids(list)).toEqual(["p3", "p1", "p4", "p2", "p5", "p6"]);
    sort.set("title");
    expect(ids(list).at(-1)).toBe("p5");
    sort.set("title", "desc");
    expect(ids(list).at(-1)).toBe("p5");
  });
});

// ─── toggle (decision 9) ─────────────────────────────────────────────────────

describe("toggle", () => {
  it("none → asc → desc → none", () => {
    const { list, sort } = products();
    expect(sort.by).toEqual([]);
    sort.toggle("price");
    expect(sort.by).toEqual([{ key: "price", dir: "asc" }]);
    expect([sort.key, sort.dir]).toEqual(["price", "asc"]);
    sort.toggle("price");
    expect([sort.key, sort.dir]).toEqual(["price", "desc"]);
    expect(ids(list)).toEqual(["p1", "p3", "p2", "p4"]);
    sort.toggle("price");
    expect(sort.by).toEqual([]);
    expect([sort.key, sort.dir]).toEqual([null, null]);
    expect(ids(list)).toEqual(["p1", "p2", "p3", "p4"]); // the list's own order
  });

  it("another key starts at asc", () => {
    const { sort } = products();
    sort.toggle("price");
    sort.toggle("title");
    expect(sort.by).toEqual([{ key: "title", dir: "asc" }]);
  });

  it("with $default the third press returns to it; the list is sorted by it from the first load", () => {
    const { list, sort } = products({ $default: "-price", title: true, price: true });
    expect(sort.by).toEqual([{ key: "price", dir: "desc" }]);
    expect(ids(list)).toEqual(["p1", "p3", "p2", "p4"]);
    sort.toggle("title");
    sort.toggle("title");
    expect(sort.by).toEqual([{ key: "title", dir: "desc" }]);
    sort.toggle("title");
    expect(sort.by).toEqual([{ key: "price", dir: "desc" }]);
    expect(ids(list)).toEqual(["p1", "p3", "p2", "p4"]);
  });

  it("a $default on the same key does not get stuck: desc → asc → desc", () => {
    const { sort } = products({ $default: "-price", price: true });
    sort.toggle("price"); // desc is the $default state: the next step is asc, not "back to desc"
    expect(sort.by).toEqual([{ key: "price", dir: "asc" }]);
    sort.toggle("price");
    expect(sort.by).toEqual([{ key: "price", dir: "desc" }]);
    sort.toggle("price");
    expect(sort.by).toEqual([{ key: "price", dir: "asc" }]);

    const asc = products({ $default: "price", price: true }).sort;
    asc.toggle("price");
    expect(asc.by).toEqual([{ key: "price", dir: "desc" }]);
    asc.toggle("price");
    expect(asc.by).toEqual([{ key: "price", dir: "asc" }]);
  });

  it("an unknown key throws", () => {
    const { sort } = products({ title: true });
    expect(() => sort.toggle("price")).toThrow('[palistor] unknown sort key "price" on list "products" (sortable: title).');
  });
});

// ─── The rest of list.sort (decision 10) ─────────────────────────────────────

describe("set, clear, reset, dirOf, keys", () => {
  it("set: a key and a direction (asc by default); a bad direction throws", () => {
    const { sort } = products();
    sort.set("title", "desc");
    expect(sort.by).toEqual([{ key: "title", dir: "desc" }]);
    sort.set("title");
    expect(sort.by).toEqual([{ key: "title", dir: "asc" }]);
    expect(() => sort.set("title", "up" as "asc")).toThrow('the direction must be "asc" or "desc"');
    expect(() => sort.set("nope" as "title")).toThrow('unknown sort key "nope"');
  });

  it("clear: no sort, the list's own order; reset: back to $default (or to no sort)", () => {
    const { list, sort } = products({ $default: "title", title: true, price: true });
    sort.set("price", "desc");
    sort.clear();
    expect(sort.by).toEqual([]);
    expect(ids(list)).toEqual(["p1", "p2", "p3", "p4"]);
    sort.reset();
    expect(sort.by).toEqual([{ key: "title", dir: "asc" }]);
    expect(ids(list)).toEqual(["p4", "p3", "p2", "p1"]);

    const plain = products();
    plain.sort.set("price");
    plain.sort.reset();
    expect(plain.sort.by).toEqual([]);
  });

  it("dirOf", () => {
    const { sort } = products();
    sort.set("price", "desc");
    expect(sort.dirOf("price")).toBe("desc");
    expect(sort.dirOf("title")).toBeNull();
  });

  it("keys: `sort: true` — every leaf of the template, a leaf in a group as a path; named fields — only those", () => {
    type Customer = { id: string; name: string; address: { city: string; street: string }; orders: { id: string }[] };
    const store = new Palistor({
      config: {
        customers: defineList<Customer>({
          template: {
            id: { value: "" }, name: { value: "" },
            address: { city: { value: "" }, street: { value: "" } },
            orders: defineList<{ id: string }>({ template: { id: { value: "" } } }),
          } as any,
          sort: true,
        }),
      },
    });
    const list = store.proxy.customers;
    expect(list.sort!.keys).toEqual(["id", "name", "address.city", "address.street"]);

    store.set([
      { id: "c1", name: "A", address: { city: "Riga", street: "x" } },
      { id: "c2", name: "B", address: { city: "Berlin", street: "y" } },
    ]);
    list.setItems(["c1", "c2"]);
    list.sort!.set("address.city");
    expect(ids(list)).toEqual(["c2", "c1"]);
    expect(() => list.sort!.set("orders" as "id")).toThrow('unknown sort key "orders"');

    expect(products({ price: true, title: true }).sort.keys).toEqual(["price", "title"]);
    expect(products({ $default: "price" } as SortBlock<Product>).sort.keys).toEqual(["id", "title", "price", "category", "inStock", "rating"]);
  });

  it("`id` sorts even when the template has no id leaf: every row has one", () => {
    type Tag = { id: string; name: string };
    const store = new Palistor({ config: { tags: defineList<Tag>({ template: { name: { value: "" } } as any, sort: { id: true, name: true } }) } });
    const list = store.proxy.tags;
    store.set([{ id: "t2", name: "a" }, { id: "t10", name: "b" }, { id: "t1", name: "c" }]);
    list.setItems(["t2", "t10", "t1"]);
    list.sort!.set("id");
    expect(ids(list)).toEqual(["t1", "t2", "t10"]);
    expect(new Palistor({ config: { tags: defineList<Tag>({ template: { name: { value: "" } } as any, sort: true }) } }).proxy.tags.sort!.keys).toEqual(["name"]);
  });

  it("the node: own keys, stable functions, read-only", () => {
    const { sort } = products();
    expect(Object.keys(sort)).toEqual([
      "by", "key", "dir", "keys", "dirOf", "toggle", "set", "clear", "reset", "refresh", "sortDescriptor", "onSortChange",
    ]);
    expect(sort.toggle).toBe(sort.toggle);
    expect(() => { (sort as any).key = "price"; }).toThrow("cannot assign to list.sort.key");
  });
});

describe("sortDescriptor / onSortChange (React Aria, HeroUI)", () => {
  it("sortDescriptor: undefined without a sort, one object per state", () => {
    const { sort } = products();
    expect(sort.sortDescriptor).toBeUndefined();
    sort.set("price");
    const d = sort.sortDescriptor;
    expect(d).toEqual({ column: "price", direction: "ascending" });
    expect(sort.sortDescriptor).toBe(d);
    sort.set("price", "desc");
    expect(sort.sortDescriptor).toEqual({ column: "price", direction: "descending" });
  });

  it("onSortChange: a header press on the sorted column runs the toggle cycle (the third press clears); another descriptor is set as given", () => {
    const { sort } = products();
    sort.onSortChange({ column: "price", direction: "ascending" }); // React Aria's first press
    expect(sort.by).toEqual([{ key: "price", dir: "asc" }]);
    sort.onSortChange({ column: "price", direction: "descending" });
    expect(sort.by).toEqual([{ key: "price", dir: "desc" }]);
    sort.onSortChange({ column: "price", direction: "ascending" }); // React Aria flips desc → asc; the cycle clears
    expect(sort.by).toEqual([]);
    sort.onSortChange({ column: "title", direction: "descending" });
    expect(sort.by).toEqual([{ key: "title", dir: "desc" }]);
    expect(() => sort.onSortChange({ column: "nope", direction: "ascending" })).toThrow('unknown sort key "nope"');
  });
});

// ─── by and compare ──────────────────────────────────────────────────────────

describe("by and compare", () => {
  type Order = { id: string; firstName: string; lastName: string; priority: "low" | "high" | "urgent" };
  const RANK = { low: 0, high: 1, urgent: 2 };
  const ORDERS: Order[] = [
    { id: "o1", firstName: "Ann", lastName: "Smith", priority: "high" },
    { id: "o2", firstName: "Bob", lastName: "Adams", priority: "urgent" },
    { id: "o3", firstName: "Al", lastName: "Smith", priority: "low" },
  ];

  function orders() {
    const store = new Palistor({
      config: {
        orders: defineList<Order>({
          template: { id: { value: "" }, firstName: { value: "" }, lastName: { value: "" }, priority: { value: "low" } } as any,
          sort: {
            lastName: { by: (row) => `${row.lastName} ${row.firstName}` },
            priority: { compare: (a, b) => RANK[a.priority] - RANK[b.priority] },
          },
        }),
      },
    });
    const list = store.proxy.orders;
    store.set(ORDERS);
    list.setItems(ORDERS.map((o) => o.id));
    return { list, sort: list.sort! };
  }

  it("by: the value a function computes from the row", () => {
    const { list, sort } = orders();
    sort.set("lastName");
    expect(ids(list)).toEqual(["o2", "o3", "o1"]); // Adams Bob, Smith Al, Smith Ann
    sort.set("lastName", "desc");
    expect(ids(list)).toEqual(["o1", "o3", "o2"]);
  });

  it("compare: your own order; desc negates it", () => {
    const { list, sort } = orders();
    sort.set("priority");
    expect(ids(list)).toEqual(["o3", "o1", "o2"]);
    sort.set("priority", "desc");
    expect(ids(list)).toEqual(["o2", "o1", "o3"]);
  });
});

// ─── Construction errors (decision 3) ────────────────────────────────────────

describe("config that can never apply throws when the store is created", () => {
  const make = (sort: unknown, resolve?: Record<string, unknown>) => () =>
    new Palistor({ config: { products: defineList<Product>({ template, sort: sort as SortBlock<Product>, resolve: resolve as any }) } });
  const paged = { pagination: { pageSize: 10 }, resolver: async () => ({ items: [], total: 0 }) };

  it("by / compare on a server list (paginated, or $server: true)", () => {
    expect(make({ title: { by: (r: Product) => r.title } }, paged)).toThrow(
      '[palistor] sort field "title" on list "products" declares "by", but the server sorts this list (resolve.pagination)',
    );
    expect(make({ $server: true, price: { compare: () => 0 } }, { resolver: async () => [] })).toThrow(
      'declares "compare", but the server sorts this list ($server: true)',
    );
  });

  it("param on a client list", () => {
    expect(make({ price: { param: "price_cents" } })).toThrow(
      'sort field "price" on list "products" declares "param", but this list holds all its rows and sorts them itself',
    );
  });

  it("an unknown $ option", () => {
    expect(make({ $multi: true, price: true })).toThrow(
      '[palistor] unknown sort block option "$multi" on list "products" (known: $default, $server, $locale).',
    );
  });

  it("$default by a key that does not sort", () => {
    expect(make({ $default: "-rating", price: true })).toThrow(
      '[palistor] sort "$default" on list "products": "rating" is not a sortable key (sortable: price).',
    );
  });

  it("a value sort by a key that is not a leaf of the template", () => {
    expect(make({ name: true })).toThrow('sort field "name" on list "products" is not a leaf of the template');
  });

  it("malformed fields and options", () => {
    expect(make("price")).toThrow('sort on list "products" must be true or an object');
    expect(make({ price: false })).toThrow('sort field "price" on list "products" must be true, { by }, { compare } or { param }.');
    expect(make({ price: { dir: "desc" } })).toThrow('unknown option "dir" (known: by, compare, param)');
    expect(make({ price: { by: "price" } })).toThrow('"by" must be a function');
    expect(make({ price: { by: () => 1, compare: () => 0 } })).toThrow('declares both "by" and "compare"');
    expect(make({ $locale: "not a locale!!" })).toThrow('sort "$locale" on list "products"');
    expect(make({ $locale: "de" }, paged)).toThrow('"$locale" on list "products" can never apply');
    expect(make({ $server: true })).toThrow('is a server sort ("$server: true"), but the list has no resolver');
    expect(make({ $server: false }, paged)).toThrow('declares "$server: false", but a paginated list holds one page');
  });

  it("a server list accepts true and { param }, a client list { by } and { compare }", () => {
    expect(make({ $default: "-price", title: true, price: { param: "price_cents" } }, paged)).not.toThrow();
    expect(make({ $server: true, price: { param: "p" } }, { resolver: async () => [] })).not.toThrow();
    expect(make({ title: { by: (r: Product) => r.title }, price: { compare: () => 0 } })).not.toThrow();
  });
});

// ─── Projection (decision 7) ─────────────────────────────────────────────────

describe("a projection over the membership", () => {
  it("the client filter narrows the sorted rows and keeps their order", async () => {
    const store = new Palistor({
      config: {
        products: defineList<Product>({
          template,
          filter: { category: { value: "", where: (p: Product, v: string) => p.category === v } },
          sort: true,
          resolve: { resolver: async () => PRODUCTS },
        }),
      },
    });
    const list = store.proxy.products;
    void list.items;
    await flush(); // loaded rows: the filter applies to them (a row added locally always shows)
    list.sort!.set("price", "desc");
    list.filter!.category.value = "a";
    expect(ids(list)).toEqual(["p2", "p4"]);
    expect(list.length).toBe(2);
    list.filter!.category.value = "b";
    expect(ids(list)).toEqual(["p1", "p3"]);
    list.filter!.clear();
    expect(ids(list)).toEqual(["p1", "p3", "p2", "p4"]); // all rows, still sorted
    expect(list.sort!.by).toEqual([{ key: "price", dir: "desc" }]);
  });

  it("getById, getValues(), dirty and store.getValues() keep the membership and its order", async () => {
    const store = new Palistor({ config: { products: defineList<Product>({ template, sort: true, resolve: { resolver: async () => PRODUCTS } }) } });
    const list = store.proxy.products;
    void list.items;
    await flush();
    const sort = list.sort!;
    const values = store.getValues();
    sort.set("title");
    expect(ids(list)).toEqual(["p4", "p3", "p2", "p1"]);
    expect(list.getValues().map((p) => p.id)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(store.getValues()).toEqual(values);
    expect(list.dirty).toBe(false);
    expect((list.getById("p3") as any).id).toBe("p3");
    expect(list.map((_row, i, id) => `${i}:${id}`)).toEqual(["0:p4", "1:p3", "2:p2", "3:p1"]);
    expect([...list].map((row: any) => row.id)).toEqual(["p4", "p3", "p2", "p1"]);
  });
});

// ─── The order is a snapshot (decision 8) ────────────────────────────────────

describe("the order is a snapshot", () => {
  it("a value edit in the sorted column moves nothing and keeps the items array; refresh() puts the row in place", () => {
    const { store, list, sort } = products();
    sort.set("price");
    expect(ids(list)).toEqual(["p2", "p4", "p3", "p1"]);
    const items = list.items;
    const version = store.getNodeVersion(list);

    (list.getById("p2") as any).price.value = 99;
    store.set({ id: "p4", price: 50 }); // a write from outside (realtime)
    expect(list.items).toBe(items);
    expect(store.getNodeVersion(list)).toBe(version);

    sort.refresh();
    expect(ids(list)).toEqual(["p3", "p1", "p4", "p2"]);
    expect(list.items).not.toBe(items);
  });

  it("refresh() with nothing to move keeps the array and does not notify", () => {
    const { store, list, sort } = products();
    sort.set("price");
    const items = list.items;
    const listener = vi.fn();
    store.subscribeGlobal(listener);
    sort.refresh();
    expect(list.items).toBe(items);
    expect(listener).not.toHaveBeenCalled();
  });

  it("remove and store.delete take the row out; the rest stay where they were", () => {
    const { store, list, sort } = products();
    sort.set("price");
    store.set({ id: "p3", price: 1 }); // p3 would now sort first; the snapshot keeps it third
    list.remove("p4");
    expect(ids(list)).toEqual(["p2", "p3", "p1"]);
    store.delete("p2");
    expect(ids(list)).toEqual(["p3", "p1"]);
  });

  it("add: the new row goes to the end; a toggle puts it in place", () => {
    const { store, list, sort } = products();
    sort.set("price");
    list.add({ id: "p5", title: "New", price: 15, category: "a", inStock: true, rating: 1 });
    expect(ids(list)).toEqual(["p2", "p4", "p3", "p1", "p5"]);
    sort.toggle("price"); // asc → desc: a new order from the current values
    expect(ids(list)).toEqual(["p1", "p3", "p5", "p2", "p4"]);
    store.set({ id: "p6", title: "Six", price: 0, category: "a", inStock: true, rating: 1 });
    list.add("p6");
    expect(ids(list).at(-1)).toBe("p6");
  });

  it("removed and added again before a read: at the end, like any new row", () => {
    const { list, sort } = products();
    sort.set("price");
    list.remove("p2");
    list.add("p2");
    expect(ids(list)).toEqual(["p4", "p3", "p1", "p2"]);
  });

  it("setItems orders the new membership", () => {
    const { store, list, sort } = products();
    sort.set("price");
    list.add({ id: "p5", title: "New", price: 15, category: "a", inStock: true, rating: 1 });
    list.setItems(["p1", "p5", "p2"]);
    expect(ids(list)).toEqual(["p2", "p5", "p1"]);
    expect((store.getValues().products as unknown as Product[]).map((p) => p.id)).toEqual(["p1", "p5", "p2"]);
  });

  it("store.rekey keeps the row's place", () => {
    const { store, list, sort } = products();
    sort.set("price");
    const tmp = (list.add({ title: "New", price: 15, category: "a", inStock: true, rating: 1 }) as any).id as string;
    expect(tmp.startsWith("_tmp_")).toBe(true);
    sort.set("price", "desc");
    expect(ids(list)).toEqual(["p1", "p3", tmp, "p2", "p4"]);
    store.rekey(tmp, "p5");
    expect(ids(list)).toEqual(["p1", "p3", "p5", "p2", "p4"]);
    store.set({ id: "p5", price: 100 });
    expect(ids(list)).toEqual(["p1", "p3", "p5", "p2", "p4"]);
  });

  it("a reload orders what it loads: the added row is in place after it", async () => {
    let rows = PRODUCTS;
    const store = new Palistor({
      config: { products: defineList<Product>({ template, sort: { $default: "price", price: true }, resolve: { resolver: async () => rows } }) },
    });
    const list = store.proxy.products;
    void list.items;
    await flush();
    expect(ids(list)).toEqual(["p2", "p4", "p3", "p1"]);

    const added = { id: "p5", title: "New", price: 15, category: "a", inStock: true, rating: 1 };
    list.add(added);
    expect(ids(list)).toEqual(["p2", "p4", "p3", "p1", "p5"]);
    rows = [...PRODUCTS, added]; // saved on the server
    list.reload();
    await flush();
    expect(ids(list)).toEqual(["p2", "p4", "p5", "p3", "p1"]);
  });
});

// ─── The resolver (decision 11, client side) ─────────────────────────────────

describe("the resolver", () => {
  it("is not called by a sort change; ctx.sort is empty for a client sort", async () => {
    const seen: ListResolveContext[] = [];
    const resolver = vi.fn(async (_v: unknown, _s: unknown, ctx: ListResolveContext) => { seen.push(ctx); return PRODUCTS; });
    const store = new Palistor({ config: { products: defineList<Product>({ template, sort: true, resolve: { resolver } }) } });
    const list = store.proxy.products;
    void list.items;
    await flush();
    const sort = list.sort!;
    sort.toggle("price");
    sort.set("title", "desc");
    sort.refresh();
    sort.clear();
    sort.reset();
    sort.onSortChange({ column: "price", direction: "ascending" });
    await flush();
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(seen[0].sort).toEqual({ by: [], key: "" });
    expect(seen[0].queryKey).toBe("");
  });

  it("ctx.sort is there on a list without a sort block too, paginated or not; queryKey is what it was", async () => {
    const plain = vi.fn(async (_v: unknown, _s: unknown, _ctx: ListResolveContext) => PRODUCTS);
    const paged = vi.fn(async (_v: unknown, _s: unknown, _ctx: ListResolveContext) => ({ items: PRODUCTS, total: 4 }));
    const store = new Palistor({
      config: {
        a: defineList<Product>({ template, filter: { q: "" }, resolve: { resolver: plain } }),
        b: defineList<Product>({ template, resolve: { resolver: paged, pagination: { pageSize: 10 } } }),
      },
    });
    void store.proxy.a.items;
    void store.proxy.b.items;
    await flush();
    expect(plain.mock.calls[0][2].sort).toEqual({ by: [], key: "" });
    expect(plain.mock.calls[0][2].queryKey).toBe('{"q":""}');
    expect(paged.mock.calls[0][2].sort).toEqual({ by: [], key: "" });
    expect(paged.mock.calls[0][2].queryKey).toBe(paged.mock.calls[0][2].page!.queryKey);
  });
});

// ─── Outside the form (decision 12), root lists only (decision 13) ──────────

describe("outside the form", () => {
  it("store.reset() keeps the sort; values and getValues() have no sort key", () => {
    const { store, list, sort } = products();
    sort.set("price", "desc");
    store.reset();
    expect(sort.by).toEqual([{ key: "price", dir: "desc" }]);
    expect(ids(list)).toEqual(["p1", "p3", "p2", "p4"]);
    expect(Object.keys(store.proxy.values)).toEqual(["products"]);
    expect(Object.keys(store.getValues())).toEqual(["products"]);
  });

  it("a list without a sort block has no `sort`", () => {
    const store = new Palistor({ config: { products: defineList<Product>({ template }) } });
    expect(store.proxy.products.sort).toBeUndefined();
    expect(Object.keys(store.proxy.products)).not.toContain("sort");
  });

  it("a sort on a nested (per-entity) list is ignored with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    type Tag = { id: string; name: string };
    const store = new Palistor({
      config: {
        posts: defineList<{ id: string; tags: Tag[] }>({
          template: { id: { value: "" }, tags: defineList<Tag>({ template: { id: { value: "" }, name: { value: "" } }, sort: true }) } as any,
        }),
      },
    });
    expect(warn).toHaveBeenCalledWith('[palistor] sort on nested list "posts[].tags" is not supported — ignored (only a root list sorts).');
    store.proxy.posts.setItems([{ id: "x", tags: [] }] as any);
    const post = store.proxy.posts.items[0] as any;
    expect(post.tags.sort).toBeUndefined();
    warn.mockRestore();
  });
});

describe("fieldMapping", () => {
  it("leaves the sort block as it is: its keys and options are not field-state names", () => {
    // `label` → `by` would turn a sort field's `{ by }` into `{ label }` if the block were normalized.
    const store = new Palistor({
      config: {
        products: defineList<Product>({
          template,
          sort: { $default: "-price", price: true, title: { by: (row) => row.title.length } },
        }),
      },
      fieldMapping: defineFieldMapping({ label: "by", isRequired: "required" }),
    });
    const list = store.proxy.products;
    store.set(PRODUCTS);
    list.setItems(PRODUCTS.map((p) => p.id));
    expect(ids(list)).toEqual(["p1", "p3", "p2", "p4"]);
    list.sort!.set("title");
    expect(ids(list)).toEqual(["p4", "p2", "p3", "p1"]); // lengths 5, 7, 7, 8
  });
});
