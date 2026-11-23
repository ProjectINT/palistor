export interface Customer {
  id: string;
  name: string;
}

/**
 * The browser's API client. On the server the page reads the customers itself
 * and passes them down as props; this function must not be called there.
 */
export async function fetchCustomers(accountId: string, search: string): Promise<Customer[]> {
  const response = await fetch(`/api/accounts/${accountId}/customers?search=${encodeURIComponent(search)}`);
  if (!response.ok) throw new Error(`GET customers failed with ${response.status}`);
  return response.json();
}
