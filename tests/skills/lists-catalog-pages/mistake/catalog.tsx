// The mistake: "Ignoring ctx.page" (skills/palistor-lists/references/pagination.md,
// Common mistakes) — the page number is kept in a form field and the offset is
// computed from it, on a plain list without `resolve.pagination`. Every page
// change is then a dependency change: the list refetches and nothing is cached.
import { defineList, Palistor, useForm } from "palistor";
import type { PalistorRef } from "palistor";
import { fetchProducts, type Product } from "./api";

const PAGE_SIZE = 5;

const products = defineList<Product>({
  template: { id: { value: "" }, name: { value: "" }, inStock: { value: false } },
  filter: {
    search: { value: "", debounce: 300 },
    inStockOnly: { value: false, where: (product: Product, on: boolean) => product.inStock === on },
  },
  resolve: {
    resolver: async (values, store, ctx) => {
      const { search } = ctx.filter.params as { search: string };
      const result = await fetchProducts({ search, offset: (values.page - 1) * PAGE_SIZE, limit: PAGE_SIZE });
      values.total = result.total;
      return result.rows;
    },
  },
});

export const catalogStore = new Palistor({
  config: { page: { value: 1 }, total: { value: 0 }, products },
});

export function CatalogScreen() {
  const form = useForm(catalogStore);
  const list = form.products;
  const filter = list.filter!;
  const page = form.page.value;
  const pageCount = Math.ceil(form.total.value / PAGE_SIZE);
  const loaded = list.resolveStatus === "resolved" || list.length > 0;

  return (
    <div>
      <input
        aria-label="Search"
        value={filter.search.value}
        onChange={(event) => {
          filter.search.onValueChange(event.target.value);
          if (form.page.value !== 1) form.page.onValueChange(1);
        }}
      />
      <label>
        <input
          type="checkbox"
          checked={filter.inStockOnly.value}
          onChange={(event) => filter.inStockOnly.onValueChange(event.target.checked)}
        />
        In stock only
      </label>

      {loaded ? (
        <ul>
          {list.map((product, index, id) => (
            <ProductRow key={id} product={product} />
          ))}
        </ul>
      ) : (
        <p>Loading products…</p>
      )}

      <button disabled={page <= 1} onClick={() => form.page.onValueChange(page - 1)}>Previous</button>
      <span>Page {page} of {pageCount}</span>
      <button disabled={page >= pageCount} onClick={() => form.page.onValueChange(page + 1)}>Next</button>
    </div>
  );
}

function ProductRow({ product }: { product: PalistorRef<Product> }) {
  return <li>{useForm(product).name.value}</li>;
}
