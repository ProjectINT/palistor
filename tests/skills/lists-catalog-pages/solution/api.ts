export interface Product {
  id: string;
  name: string;
  inStock: boolean;
}

export interface ProductQuery {
  search: string;
  offset: number;
  limit: number;
}

export async function fetchProducts(query: ProductQuery): Promise<{ rows: Product[]; total: number }> {
  const params = new URLSearchParams({
    search: query.search,
    offset: String(query.offset),
    limit: String(query.limit),
  });
  const response = await fetch(`/api/products?${params}`);
  if (!response.ok) throw new Error(`GET /api/products failed with ${response.status}`);
  return response.json();
}
