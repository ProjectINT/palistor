# Task: customers list with a filter panel

Our React app keeps screen state in `palistor`. Build the customers screen in `customers.tsx`.

The API client already exists in `api.ts` (do not change it): `fetchCustomers({ search, role, offset, limit }): Promise<{ rows: Customer[]; total: number }>`, where `Customer` is `{ id, name, role }`, `search` is part of a name (`""` for any) and `role` is `"admin"`, `"editor"`, `"viewer"` or `""` for any role. `total` is the number of customers that match.

Export from `customers.tsx`:

- `customersStore` — the Palistor store that holds the screen state
- `CustomersScreen` — the React component

Behavior:

1. Customers are shown 5 per page, one list item per customer with the customer's name as its text. Below the list: a "Previous" button, the text "Page X of Y" and a "Next" button; a button is disabled when there is no such page. The first load says "Loading customers…".
2. Above the list, a filter panel: a text box (accessible name "Search") and a select (accessible name "Role") with the options "Any role" (value `""`), "admin", "editor" and "viewer". The server does the filtering: the request carries the panel's values as `search` and `role`.
3. Changing the panel's fields changes neither the list nor anything else on screen, and sends no request. The user can pick several filters first.
4. An "Apply" button sends the panel's values: exactly one request, and the list shows page 1 of the result. Pressing Enter in the search box does the same as Apply. "Apply" is disabled while the panel shows the values that are already applied.
5. A "Cancel" button puts the panel back to the values that are currently applied. It sends no request.
6. A badge "Filters: N" shows how many filters are applied (a non-empty search and a chosen role count one each). It is hidden when no filter is applied, and edits that are not applied yet do not change it.
