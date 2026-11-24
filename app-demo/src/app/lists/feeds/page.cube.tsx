import { ListsProviders } from "../shared/ListsProviders";
import { FeedsView } from "./FeedsView";

// /lists/feeds — a Server Component, like the Products page (../page.cube.tsx):
// the providers and the client view. Cube only (page.cube.tsx).

export default function ListsFeedsPage() {
  return (
    <ListsProviders>
      <FeedsView />
    </ListsProviders>
  );
}
