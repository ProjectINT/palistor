import { useState, type ReactNode } from "react";
import { defineList, Palistor, useForm } from "palistor";
import type { PalistorList, PalistorRef, SortProxyNode } from "palistor";
import { fetchProducts, type Product } from "./api";

type ProductKey = keyof Product & string; // a flat entity: its keys are the sort keys
const PAGE_SIZE = 5;

const products = defineList<Product>({
  template: { id: { value: "" }, name: { value: "" }, price: { value: 0 }, rating: { value: null as number | null } },
  // A list without pagination holds every product and sorts them itself: no request.
  sort: { name: true, price: true, rating: true },
  resolve: { resolver: async () => fetchProducts() },
});

export const productsStore = new Palistor({ config: { products } });

export function ProductsScreen() {
  return <ProductsTable products={useForm(productsStore).products} />;
}

function ProductsTable({ products }: { products: PalistorList<Product> }) {
  const list = useForm(products);
  const [page, setPage] = useState(1);
  const count = list.length; // starts the lazy load: above every early return

  if (list.resolveStatus === "error") {
    return (
      <div>
        <p>Could not load products</p>
        <button onClick={list.reload}>Retry</button>
      </div>
    );
  }
  if (list.resolveStatus !== "resolved") return <p>Loading products…</p>;

  const sort = list.sort!; // typed optional: present because the block is declared
  // Rows in the sorted order; the page is a slice of them, so a sort orders every product.
  const rows = list.map((row, index, id) => <ProductRow key={id} product={row} />);
  const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const current = Math.min(page, pageCount);

  return (
    <div>
      <table>
        <thead>
          <tr>
            <SortHeader sort={sort} column="name">Name</SortHeader>
            <SortHeader sort={sort} column="price">Price</SortHeader>
            <SortHeader sort={sort} column="rating">Rating</SortHeader>
          </tr>
        </thead>
        <tbody>{rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)}</tbody>
      </table>
      {/* The order is a snapshot: edits move nothing until the sort is computed again. */}
      <button onClick={() => sort.refresh()}>Re-sort</button>
      <button disabled={current <= 1} onClick={() => setPage(current - 1)}>Previous</button>
      <span>Page {current} of {pageCount}</span>
      <button disabled={current >= pageCount} onClick={() => setPage(current + 1)}>Next</button>
    </div>
  );
}

function SortHeader({ sort, column, children }: { sort: SortProxyNode<ProductKey>; column: ProductKey; children: ReactNode }) {
  const s = useForm(sort); // re-renders when the sort changes
  const dir = s.dirOf(column);
  return (
    <th aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}>
      <button onClick={() => s.toggle(column)}>{children}</button>
    </th>
  );
}

function ProductRow({ product }: { product: PalistorRef<Product> }) {
  const p = useForm(product);
  return (
    <tr>
      <td>{p.name.value}</td>
      <td>
        <input
          type="number"
          aria-label="Price"
          value={p.price.value}
          onChange={(event) => p.price.onValueChange(Number(event.target.value))}
        />
      </td>
      <td>{p.rating.value ?? ""}</td>
    </tr>
  );
}
