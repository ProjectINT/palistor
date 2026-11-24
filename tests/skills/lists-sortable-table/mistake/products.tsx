// Mistake: "Sorting rows in the component" (skills/palistor-lists/references/sorting.md). The page is sliced
// out of the loaded rows first and then sorted in a useMemo: a sort orders the five rows on screen, and a
// price edit re-sorts them at once. Everything else (empties last, numeric names, the toggle cycle) is right.
import { useMemo, useState } from "react";
import { defineList, Palistor, useForm } from "palistor";
import type { PalistorRef } from "palistor";
import { fetchProducts, type Product } from "./api";

type Column = "name" | "price" | "rating";
const PAGE_SIZE = 5;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const products = defineList<Product>({
  template: { id: { value: "" }, name: { value: "" }, price: { value: 0 }, rating: { value: null as number | null } },
  resolve: { resolver: async () => fetchProducts() },
});

export const productsStore = new Palistor({ config: { products } });

function compare(a: Product, b: Product, column: Column, dir: "asc" | "desc"): number {
  const x = a[column];
  const y = b[column];
  if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1; // empties last in both directions
  const r = typeof x === "string" ? collator.compare(x, String(y)) : (x as number) - (y as number);
  return dir === "asc" ? r : -r;
}

export function ProductsScreen() {
  const list = useForm(productsStore).products;
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<Column | null>(null);
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [, setTick] = useState(0);
  const count = list.length;

  const pageRows = list.items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) as any[];
  const shown = useMemo(
    () => (sortKey ? [...pageRows].sort((a, b) => compare(a.values, b.values, sortKey, dir)) : pageRows),
    [pageRows, sortKey, dir],
  );

  if (list.resolveStatus !== "resolved") return <p>Loading products…</p>;

  const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const press = (column: Column) => {
    if (sortKey !== column) { setSortKey(column); setDir("asc"); }
    else if (dir === "asc") setDir("desc");
    else setSortKey(null);
  };
  const ariaSort = (column: Column) => (sortKey !== column ? "none" : dir === "asc" ? "ascending" : "descending");

  return (
    <div>
      <table>
        <thead>
          <tr>
            <th aria-sort={ariaSort("name")}><button onClick={() => press("name")}>Name</button></th>
            <th aria-sort={ariaSort("price")}><button onClick={() => press("price")}>Price</button></th>
            <th aria-sort={ariaSort("rating")}><button onClick={() => press("rating")}>Rating</button></th>
          </tr>
        </thead>
        <tbody>{shown.map((row) => <ProductRow key={row.id} product={row} />)}</tbody>
      </table>
      <button onClick={() => setTick((n) => n + 1)}>Re-sort</button>
      <button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
      <span>Page {page} of {pageCount}</span>
      <button disabled={page >= pageCount} onClick={() => setPage(page + 1)}>Next</button>
    </div>
  );
}

function ProductRow({ product }: { product: PalistorRef<Product> }) {
  const p = useForm(product);
  return (
    <tr>
      <td>{p.name.value}</td>
      <td>
        <input type="number" aria-label="Price" value={p.price.value} onChange={(event) => p.price.onValueChange(Number(event.target.value))} />
      </td>
      <td>{p.rating.value ?? ""}</td>
    </tr>
  );
}
