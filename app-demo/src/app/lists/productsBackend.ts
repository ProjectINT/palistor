// The "backend" of the /lists Products page: fake endpoints the store's
// resolvers call. They answer from memory after a delay and count their calls
// (ssr/shared/events.ts, shown by <Counter>); nothing touches the network.
//
// The rows are chosen for the sort tests to come (experiments/SortPlan.md,
// Stage 1): titles that differ only by a number ("Desk lamp 2" / "Desk lamp
// 10") or by case ("Oak shelf" / "oak Shelf", "apple crate"), equal prices,
// ratings that are null, and a server order that follows no column.

import { fakeRequest } from "@/app/ssr/shared/events";

import table from "./products.json";

export interface Product {
  id: string;
  title: string;
  price: number;
  category: string;
  inStock: boolean;
  /** ISO date-time. */
  createdAt: string;
  /** null: not rated yet. */
  rating: number | null;
}

const PRODUCTS = table as Product[];

/** The categories the rows use, for the category select. */
export const PRODUCT_CATEGORIES = ["Furniture", "Kitchen", "Lighting", "Textiles"] as const;

/** The favorites the "server" has saved, in their saved order. */
const SAVED_FAVORITES = ["p-09", "p-14"];

/** Copies: the store keeps what a resolver returns, the table stays as it is. */
const copy = (row: Product): Product => ({ ...row });

/** GET /products — all rows, in the server's order. */
export function fetchProducts(): Promise<Product[]> {
  return fakeRequest("lists.products", () => PRODUCTS.map(copy), 400);
}

/** GET /favorites — the saved favorites: the same entities as /products, by id. */
export function fetchFavorites(): Promise<Product[]> {
  return fakeRequest(
    "lists.favorites",
    () => SAVED_FAVORITES.map((id) => copy(PRODUCTS.find((row) => row.id === id)!)),
    500,
  );
}
