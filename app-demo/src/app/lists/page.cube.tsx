import { ListsProviders } from "./shared/ListsProviders";
import { ProductsView } from "./ProductsView";

// /lists — the Products page of the lists demo (experiments/SortPlan.md): the
// client-side lists, sorted and filtered in the browser, and the favorites.
//
// A Server Component, like the /ssr routes: it renders the providers and the
// client view, and may read the view's rows and hand them down as props (the
// store then gets them as `initialData`). <ListsProviders> would sit in a
// layout in an app; every /lists page renders it, because the root layout is
// shared with the store implementation.
//
// Cube only: `page.cube.tsx` is a route only when next.config.ts registers the
// `cube.tsx` page extension (decision 16 of the plan). The other /lists routes
// live in the subdirectories (orders/, customers/, feeds/).

export default function ListsProductsPage() {
  return (
    <ListsProviders>
      <ProductsView />
    </ListsProviders>
  );
}
