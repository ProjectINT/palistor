# Task: sortable products table

Our React app keeps screen state in `palistor`. Build the products table in `products.tsx`.

The API client already exists in `api.ts` (do not change it): `fetchProducts(): Promise<Product[]>` returns every product, where `Product` is `{ id, name, price, rating }` and `rating` is `null` for a product nobody has rated yet.

Export from `products.tsx`:

- `productsStore` — the Palistor store that holds the screen state
- `ProductsScreen` — the React component

Behavior:

1. The products load from the API once when the screen is shown; until they arrive the screen says "Loading products…".
2. A table with the columns Name, Price and Rating. Each column header cell holds a button whose text is the column name. Each product is one row of the table body: its name, its price in a number input (accessible name "Price") and its rating (an empty cell when there is none).
3. The table shows 5 products per page, with "Previous" and "Next" buttons and the text "Page X of Y" below it. A button is disabled when there is no such page.
4. Clicking a column header sorts all products by that column, ascending; a second click sorts them descending; a third click shows them in the order the API returned again. The header cell of the sorted column has `aria-sort="ascending"` or `aria-sort="descending"`, the other header cells `aria-sort="none"`.
5. A sort applies to all products, not only to the page on screen: sorted by price ascending, page 1 shows the five cheapest products.
6. Names sort the way people read them: "Lamp 2" before "Lamp 10", upper and lower case alike.
7. Products without a rating stay at the end in both directions.
8. Typing a price changes that product's price in the store (a number). While the user edits prices, rows do not jump: an edited row stays where it is. A "Re-sort" button puts every row in its place for the current sort.
9. Sorting never calls the API again.

`productsStore.getValues().products` is the array of products, each `{ id, name, price, rating }`.
