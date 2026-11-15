# Task: product catalog with search, a stock filter and pages

Our React app keeps screen state in `palistor`. Build the catalog screen in `catalog.tsx`.

The API client already exists in `api.ts` (do not change it):

`fetchProducts({ search, offset, limit }): Promise<{ rows: Product[]; total: number }>`, where `Product` is `{ id, name, inStock }` and `total` is the number of products that match `search`.

Export from `catalog.tsx`:

- `catalogStore` — the Palistor store that holds the screen state
- `CatalogScreen` — the React component

Behavior:

1. Products are shown 5 per page, one list item per product with the product's name as its text. Below the list: a "Previous" button, the text "Page X of Y" and a "Next" button. A button is disabled when there is no such page.
2. The first load says "Loading products…". After that, moving to another page keeps the current rows on screen until the new page has arrived; the loading text does not come back for a page change.
3. A page that was loaded before is shown again without another request.
4. A search box (accessible name "Search") filters on the server: the request carries the text as `search`. A burst of keystrokes sends one request, about 300 ms after the last one. A new search starts at page 1.
5. An "In stock only" checkbox hides the out-of-stock products of the current page without any request.
