// The "backend" of /lists/orders: a fake endpoint over a JSON table. The
// store's resolver calls it in the browser; it filters, sorts and slices the
// rows as a server would, answers after a delay and counts its calls under
// "lists.orders" (@/app/ssr/shared/events). Nothing here touches the network.
// The server never calls it: the page is prerendered, and a store in server
// mode runs no resolver.

import type { PagedResult } from "@palistor";

import { fakeRequest } from "@/app/ssr/shared/events";

import orderTable from "./orders.json";

export type OrderStatus = "pending" | "paid" | "shipped" | "delivered" | "cancelled";

export const ORDER_STATUSES: readonly OrderStatus[] = ["pending", "paid", "shipped", "delivered", "cancelled"];

export interface Order {
  id: string;
  /** "#1108": what the table shows and the search matches. */
  number: string;
  customer: string;
  /** US dollars. */
  amount: number;
  status: OrderStatus;
  /** ISO timestamp, UTC. The table is stored newest first. */
  createdAt: string;
}

const ORDERS = orderTable as Order[];

/** The request params, under the names the endpoint expects (the filter's `param` renames). */
export interface OrdersParams {
  search?: string;
  status_eq?: string;
}

/** One sort key as the endpoint takes it: a column name of the endpoint and a direction. */
export interface OrdersSort {
  param: string;
  dir: "asc" | "desc";
}

/** The page the store asks for (`ctx.page`). */
export interface OrdersPage {
  offset: number;
  pageSize: number;
}

/** The query of the endpoint: search and status, then the sort, then the page; `total` counts the matches. */
export function queryOrders(
  rows: readonly Order[],
  params: OrdersParams,
  page: OrdersPage,
  sort: readonly OrdersSort[] = [],
): PagedResult<Order> {
  const search = (params.search ?? "").trim().toLowerCase();
  const status = params.status_eq ?? "";
  const matches = rows.filter(
    (order) =>
      (!search || `${order.number} ${order.customer}`.toLowerCase().includes(search)) &&
      (!status || order.status === status),
  );
  const sorted = sort.length ? [...matches].sort((a, b) => compareBy(a, b, sort)) : matches;
  return { items: sorted.slice(page.offset, page.offset + page.pageSize), total: matches.length };
}

/** Endpoint column → the row value it orders by. */
const SORT_COLUMNS: Record<string, (order: Order) => string | number> = {
  number: (order) => Number(order.number.slice(1)),
  customer: (order) => order.customer,
  amount: (order) => order.amount,
  status: (order) => order.status,
  created_at: (order) => order.createdAt,
};

function compareBy(a: Order, b: Order, sort: readonly OrdersSort[]): number {
  for (const { param, dir } of sort) {
    const read = SORT_COLUMNS[param];
    if (!read) continue;
    const x = read(a);
    const y = read(b);
    const order = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "en");
    if (order !== 0) return dir === "asc" ? order : -order;
  }
  return 0;
}

// ─── The last request, for the page to show ──────────────────────────────────
// Module-level for the browser tab, like the counters: the server never sends
// a request, so its snapshot (and the hydrating render's) is null.

let lastRequest: string | null = null;
const listeners = new Set<() => void>();

/** The last request as a URL: `/api/orders?search=ali&status_eq=paid&offset=0&limit=10`. */
export function getLastRequest(): string | null {
  return lastRequest;
}

export function subscribeLastRequest(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function requestUrl(params: OrdersParams, page: OrdersPage, sort: readonly OrdersSort[]): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) if (value) query.set(name, String(value));
  if (sort.length) query.set("sort", sort.map((s) => (s.dir === "desc" ? `-${s.param}` : s.param)).join(","));
  query.set("offset", String(page.offset));
  query.set("limit", String(page.pageSize));
  return `/api/orders?${query.toString()}`;
}

// ─── The fake endpoint (browser only) ────────────────────────────────────────

/** GET /api/orders: one page of the matches and their total, after 700 ms. Counted under "lists.orders". */
export function fetchOrders(
  params: OrdersParams,
  page: OrdersPage,
  sort: readonly OrdersSort[] = [],
): Promise<PagedResult<Order>> {
  lastRequest = requestUrl(params, page, sort);
  listeners.forEach((listener) => listener());
  return fakeRequest("lists.orders", () => queryOrders(ORDERS, params, page, sort), 700);
}
