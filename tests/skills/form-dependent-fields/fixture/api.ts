// Backend client (stub). Do not change this file.
// The stub records every call so the UI tests can see what was sent.

export interface PlacedOrder {
  id: string;
}

export async function placeOrder(values: Record<string, unknown>): Promise<PlacedOrder> {
  const log = (globalThis as { __placedOrders?: unknown[] }).__placedOrders;
  log?.push(values);
  return { id: "order-1" };
}
