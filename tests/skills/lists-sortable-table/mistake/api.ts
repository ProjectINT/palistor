export interface Product {
  id: string;
  name: string;
  price: number;
  /** null: not rated yet. */
  rating: number | null;
}

/** Every product, in the order the server keeps them. */
export async function fetchProducts(): Promise<Product[]> {
  const response = await fetch("/api/products");
  if (!response.ok) throw new Error(`GET /api/products failed with ${response.status}`);
  return response.json();
}
