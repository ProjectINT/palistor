export interface Customer {
  id: string;
  name: string;
  /** "admin" | "editor" | "viewer" */
  role: string;
}

export interface CustomerQuery {
  /** Part of the name; "" for any. */
  search: string;
  /** "admin", "editor", "viewer", or "" for any role. */
  role: string;
  offset: number;
  limit: number;
}

export async function fetchCustomers(query: CustomerQuery): Promise<{ rows: Customer[]; total: number }> {
  const params = new URLSearchParams({
    search: query.search,
    role: query.role,
    offset: String(query.offset),
    limit: String(query.limit),
  });
  const response = await fetch(`/api/customers?${params}`);
  if (!response.ok) throw new Error(`GET /api/customers failed with ${response.status}`);
  return response.json();
}
