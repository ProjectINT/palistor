import { defineList, Palistor, useForm } from "palistor";
import type { PalistorRef } from "palistor";
import { fetchProducts, type Product } from "./api";

const products = defineList<Product>({
  template: { id: { value: "" }, name: { value: "" }, inStock: { value: false } },
  filter: {
    // Server field: sent to the resolver, one request 300 ms after the last keystroke.
    search: { value: "", debounce: 300 },
    // Client field: filters the loaded page in memory, never sends a request.
    inStockOnly: { value: false, where: (product: Product, on: boolean) => product.inStock === on },
  },
  resolve: {
    pagination: { pageSize: 5 },
    resolver: async (values, store, ctx) => {
      const page = ctx.page!;
      const { search } = ctx.filter.params as { search: string };
      const result = await fetchProducts({ search, offset: page.offset, limit: page.pageSize });
      return { items: result.rows, total: result.total };
    },
  },
});

export const catalogStore = new Palistor({ config: { products } });

export function CatalogScreen() {
  const list = useForm(catalogStore).products;
  const filter = list.filter!;

  return (
    <div>
      <input
        aria-label="Search"
        value={filter.search.value}
        onChange={(event) => filter.search.onValueChange(event.target.value)}
      />
      <label>
        <input
          type="checkbox"
          checked={filter.inStockOnly.value}
          onChange={(event) => filter.inStockOnly.onValueChange(event.target.checked)}
        />
        In stock only
      </label>

      {list.isInitialLoading ? (
        <p>Loading products…</p>
      ) : (
        <ul>
          {list.map((product, index, id) => (
            <ProductRow key={id} product={product} />
          ))}
        </ul>
      )}

      <button disabled={!list.hasPrevPage} onClick={list.prevPage}>Previous</button>
      <span>Page {list.page} of {list.pageCount}</span>
      <button disabled={!list.hasNextPage} onClick={list.nextPage}>Next</button>
    </div>
  );
}

function ProductRow({ product }: { product: PalistorRef<Product> }) {
  return <li>{useForm(product).name.value}</li>;
}
