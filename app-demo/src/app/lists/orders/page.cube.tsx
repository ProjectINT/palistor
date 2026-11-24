import { ListsProviders } from "../shared/ListsProviders";
import { OrdersView } from "./OrdersView";

// /lists/orders — a Server Component, like the Products page (../page.cube.tsx):
// the providers and the client view. Cube only (page.cube.tsx).

export default function ListsOrdersPage() {
  return (
    <ListsProviders>
      <OrdersView />
    </ListsProviders>
  );
}
