// The store config of /lists/orders. Module level: it holds no request data,
// only the store is per component instance (`usePalistor` in OrdersView).

import { defineList } from "@palistor";
import type { ListResolveContext, ResolveErrorContext, TranslateFn } from "@palistor";

import { fetchOrders } from "./backend";
import type { Order, OrdersParams } from "./backend";

/** The page size the list starts with, and the choices of the page-size select. */
export const ORDERS_PAGE_SIZE = 10;
export const ORDERS_PAGE_SIZES = [5, 10, 20] as const;

/** How long a cached page is shown without a background refetch (ms). */
export const ORDERS_STALE_TIME = 30_000;

/** The pause after the last keystroke before the search sends its request (ms). */
export const ORDERS_SEARCH_DEBOUNCE = 500;

/**
 * The columns of the table, in order: the one place that names them. The
 * header, the cells and the messages (`lists.orders.columns.<key>`) follow it;
 * every column is a key of the `sort` block below.
 */
export const ORDER_COLUMNS = [
  { key: "number", align: "start" },
  { key: "customer", align: "start" },
  { key: "createdAt", align: "start" },
  { key: "status", align: "start" },
  { key: "amount", align: "end" },
] as const satisfies ReadonlyArray<{ key: keyof Order & string; align: "start" | "end" }>;

export type OrderColumn = (typeof ORDER_COLUMNS)[number]["key"];

export const ordersConfig = {
  orders: defineList<Order>({
    template: {
      id: { value: "" },
      number: { value: "" },
      customer: { value: "" },
      amount: { value: 0 },
      status: { value: "pending" },
      createdAt: { value: "" },
    },
    // Server fields: no `where`, so each one reaches the resolver in
    // `ctx.filter.params`, under its `param` name, and a change is a new query
    // (the first page, one request).
    filter: {
      q: {
        value: "",
        debounce: ORDERS_SEARCH_DEBOUNCE, // one request after the pause, not one per keystroke
        param: "search",
        label: (t: TranslateFn) => t("lists.orders.search"),
        placeholder: (t: TranslateFn) => t("lists.orders.searchPlaceholder"),
      },
      status: {
        value: "", // "" = every status: an empty filter value
        param: "status_eq",
        label: (t: TranslateFn) => t("lists.orders.status"),
      },
    },
    // A paginated list holds one page, so the server sorts: the sort reaches
    // the resolver as ctx.sort and is part of the query, like a server filter
    // field — a change is one request for page 1, a sort still cached none.
    sort: {
      $default: "-createdAt", // newest first: the order the table starts in and that reset() returns to
      number: true,
      customer: true,
      amount: true,
      status: true,
      createdAt: { param: "created_at" }, // the endpoint's name for the column
    },
    resolve: {
      pagination: {
        pageSize: ORDERS_PAGE_SIZE,
        // A new query (search, status) keeps the old rows on screen until its first page lands.
        keepPreviousData: true,
        // The pages of the last three queries stay cached: going back to one of them is not a request.
        maxCachedQueries: 3,
        // A cached page older than this is still shown at once, and refetched in the background.
        staleTime: ORDERS_STALE_TIME,
      },
      // The page from ctx.page, the filter from ctx.filter.params, the sort from ctx.sort.by
      // (`{ key, param, dir }`, first entry first): the resolver keeps no state of its own.
      resolver: async (_values: unknown, _store: unknown, ctx: ListResolveContext) =>
        fetchOrders(ctx.filter.params as OrdersParams, ctx.page!, ctx.sort.by),
      onError: (_error: unknown, ctx: ResolveErrorContext) => {
        const { notify, t } = ctx as ResolveErrorContext & { t: TranslateFn }; // `t` is not in the declared type yet
        notify(t("lists.orders.loadFailed"));
      },
    },
  }),
};
