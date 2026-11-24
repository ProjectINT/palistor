import { ListsProviders } from "../shared/ListsProviders";
import { queryAccounts } from "./backend";
import { CustomersView } from "./CustomersView";

// /lists/customers — a Server Component, like the Products page
// (../page.cube.tsx): the providers and the client view. Cube only
// (page.cube.tsx). It reads the accounts, as it would query a database, and
// hands them to the view: they reach the store as `initialData`, so the server's
// HTML has them. The customers and the invoices have no server data.

export default function ListsCustomersPage() {
  return (
    <ListsProviders>
      <CustomersView accounts={queryAccounts()} />
    </ListsProviders>
  );
}
