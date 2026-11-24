// The store config of the /lists Products page (experiments/SortPlan.md,
// Stage 4a/4b). Module level: it holds no request data; ProductsView creates
// the store from it with usePalistor, once per page instance.

import { defineList } from "@palistor";
import type { ResolveErrorContext, TranslateFn } from "@palistor";

import { fetchFavorites, fetchProducts, type Product } from "./productsBackend";

/** A text of the `lists.products` block, translated by the store (the provider's translator). */
const text = (key: string) => (t: TranslateFn) => t(`lists.products.${key}`);

/** A number from an input (a string) or from `filter.set` (a number); null when there is none. */
export function toNumber(raw: unknown): number | null {
  if (raw === "" || raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** The price range of the filter's values; a reversed range is read the other way round. */
function priceBounds(values: Record<string, unknown>): [number | null, number | null] {
  const min = (values.minPrice ?? null) as number | null;
  const max = (values.maxPrice ?? null) as number | null;
  return min !== null && max !== null && min > max ? [max, min] : [min, max];
}

/** "10–50", "≥ 10", "≤ 50", or "" without bounds: symbols only, the derived value is not translated. */
function rangeText([min, max]: [number | null, number | null]): string {
  if (min !== null && max !== null) return `${min}–${max}`;
  if (min !== null) return `≥ ${min}`;
  if (max !== null) return `≤ ${max}`;
  return "";
}

/** One row of either list: both lists show the same entities, so they share the template. */
const productTemplate = {
  id: { value: "" },
  title: { value: "", label: text("columns.title") },
  // An <input> writes strings: the formatter keeps the value a number.
  price: { value: 0, label: text("columns.price"), formatter: (raw: unknown) => Math.max(0, toNumber(raw) ?? 0) },
  category: { value: "", label: text("columns.category") },
  inStock: { value: true, label: text("columns.inStock") },
  createdAt: { value: "", label: text("columns.createdAt") },
  rating: { value: null as number | null, label: text("columns.rating") },
};

const notifyFailure = (key: string) => (_error: unknown, ctx: ResolveErrorContext) => {
  // `t` is the store's translator; the declared context type has only `notify` so far.
  const { notify, t } = ctx as ResolveErrorContext & { t: TranslateFn };
  notify(t(`lists.products.${key}`));
};

/** The filter preset button: one `filter.set`, one notification. */
export const FILTER_PRESET = { category: "Lighting", inStock: true, maxPrice: 100 };

export const productsConfig = {
  // All rows in memory: every filter field below is a client field, and the
  // list sorts itself, so neither a filter change nor a sort calls the
  // resolver again.
  products: defineList<Product>({
    template: productTemplate,
    // Every template field sorts by its value. The order is a snapshot: taken
    // when the sort changes, when a load lands and on sort.refresh(); an added
    // row goes to the end and an edit moves nothing until then.
    sort: true,
    filter: {
      search: {
        value: "",
        label: text("filter.search"),
        placeholder: text("filter.searchPlaceholder"),
        where: (row: Product, query: string) => row.title.toLowerCase().includes(query.trim().toLowerCase()),
      },
      category: {
        value: "",
        label: text("filter.category"),
        where: (row: Product, category: string) => row.category === category,
      },
      // Skipped while false (an empty value): off shows every row.
      inStock: { value: false, label: text("filter.inStock"), where: (row: Product) => row.inStock },
      // The range bounds are read by $all only. `where: () => true` keeps them
      // client fields: a field without `where` is a server field, and its
      // change would call the resolver again.
      minPrice: { value: null as number | null, label: text("filter.minPrice"), formatter: toNumber, where: () => true },
      maxPrice: { value: null as number | null, label: text("filter.maxPrice"), formatter: toNumber, where: () => true },
      // Derived: read-only, neither sent nor counted in activeCount.
      priceRange: {
        value: (values: Record<string, unknown>) => rangeText(priceBounds(values)),
        label: text("filter.priceRange"),
      },
      // One rule across both bounds, after the `where`s.
      $all: (row: Product, values: Record<string, unknown>) => {
        const [min, max] = priceBounds(values);
        return (min === null || row.price >= min) && (max === null || row.price <= max);
      },
    },
    resolve: {
      resolver: async () => fetchProducts(),
      onError: notifyFailure("loadFailed"),
    },
  }),

  // The same entities in a second list: `add(id)` shows a row that is already
  // in the registry, so a price edited in one list is the price in the other.
  favorites: defineList<Product>({
    template: productTemplate,
    resolve: {
      resolver: async () => fetchFavorites(),
      onError: notifyFailure("favorites.loadFailed"),
    },
  }),
};
