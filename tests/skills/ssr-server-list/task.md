# Task: customers page rendered on the server

Our Next.js app (App Router) keeps screen state in `palistor`. Build the customers screen in `customersView.tsx`, a Client Component.

The route's Server Component already loads the customers of the account on the server and renders `<CustomersView accountId={accountId} customers={customers} />`. Already in the project (do not change them):

- `api.ts` — `fetchCustomers(accountId: string, search: string): Promise<Customer[]>`, the browser's API client. It must not be called during the server render.
- `i18n.ts` — `useT()`, the app's translation hook. It works on the server and in the browser.

Export from `customersView.tsx`:

- `CustomersView` — the React component, props `{ accountId: string; customers: Customer[] }`

Behavior:

1. The page arrives ready. The HTML rendered on the server already contains every customer passed in `customers`, each as a list item (`<li>`) with the customer's name, and a search text input whose label is the translation of `customers.search` — the translated text, not the key.
2. In the browser the page hydrates without a hydration warning, and the list is not requested again: the customers from the server stay on screen.
3. Typing in the search input loads the list with `fetchCustomers(accountId, search)`: one request per change, and the customers on screen become the ones the API returned.
4. A page can show several `CustomersView` at once, for different accounts. Each one keeps its own customers and its own search.
