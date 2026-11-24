"use client";

import { useSyncExternalStore } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Chip, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from "@heroui/react";
import { useForm, usePalistor } from "@palistor";
import type { FilterProxyNode, PalistorList, PalistorRef, SortKey, SortProxyNode } from "@palistor";

import { Block, Counter } from "@/app/ssr/shared/Block";
import { Flag, SelectField, Skeleton, Spinner, TextField, buttonClass, INPUT_CLASS } from "@/app/ssr/shared/ui";

import { ListsShell } from "../shared/ListsShell";
import { ORDER_STATUSES, getLastRequest, subscribeLastRequest } from "./backend";
import type { Order, OrderStatus } from "./backend";
import {
  ORDER_COLUMNS,
  ORDERS_PAGE_SIZES,
  ORDERS_SEARCH_DEBOUNCE,
  ORDERS_STALE_TIME,
  ordersConfig,
  type OrderColumn,
} from "./ordersConfig";

/**
 * The client side of /lists/orders: a paginated list in a HeroUI Table, its
 * server sort (the column headers), its server filter (a debounced search and
 * a status) and the pagination features: prefetch, page size, refreshing one
 * page, previous data kept while a new query loads, cached queries, staleness.
 *
 * The root of the view: it creates the store (`usePalistor`, one per mounted
 * view), calls `useForm(store)` once and hands each block its node — the
 * list, its filter, its sort — as a prop. The page is prerendered: on the server the
 * store runs no resolver, so the server's HTML (and the hydrating render)
 * shows the skeleton, and the browser loads page 1 once the view has
 * committed.
 */
export function OrdersView() {
  const t = useTranslations("lists");

  const store = usePalistor(() => ({ config: ordersConfig }));
  // Only navigates: reads no state, so a page change never re-renders the view.
  const orders = useForm(store).orders;

  return (
    <ListsShell subtitle={t("orders.subtitle")}>
      <Block
        testId="lists-orders"
        title={t("orders.title")}
        hint={t("orders.hint", { debounce: ORDERS_SEARCH_DEBOUNCE })}
        footer={
          <>
            <Counter event="lists.orders" testId="lists-orders-requests" label={t("orders.requests")} />
            <LastRequest />
          </>
        }
      >
        <div className="space-y-4">
          {/* `filter` and `sort` are typed optional: present because the config declares the blocks. */}
          <OrdersFilters filter={orders.filter!} orders={orders} />
          <OrdersTable orders={orders} sort={orders.sort!} />
          <OrdersPager orders={orders} />
          <Tips />
        </div>
      </Block>
    </ListsShell>
  );
}

// ─── Filter: server fields ───────────────────────────────────────────────────

/** The filter controls, on the filter node: reading `isPending` here subscribes to the filter, not to the list's fetches. */
function OrdersFilters({ filter, orders }: { filter: FilterProxyNode; orders: PalistorList<Order> }) {
  const t = useTranslations("lists.orders");
  const f = useForm(filter);
  const statusOptions = [
    { value: "", label: t("statuses.all") },
    ...ORDER_STATUSES.map((status) => ({ value: status, label: t(`statuses.${status}`) })),
  ];

  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
        {/* Each field component calls useForm on its own field: a keystroke re-renders the input alone. */}
        <TextField field={f.q} testId="lists-orders-search" />
        <SelectField field={f.status} testId="lists-orders-status-filter" options={statusOptions} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {/* True from the keystroke until the debounced request is sent. */}
        <Flag name="filter.isPending" value={f.isPending} testId="lists-orders-pending" />
        <FetchFlags orders={orders} />
      </div>
    </div>
  );
}

/** The list's fetch state, next to the filter: a component of its own, so a fetch re-renders the two flags alone. */
function FetchFlags({ orders }: { orders: PalistorList<Order> }) {
  const list = useForm(orders);

  return (
    <>
      <Flag name="isFetching" value={!!list.isFetching} testId="lists-orders-fetching" />
      <Flag name="isPreviousData" value={!!list.isPreviousData} testId="lists-orders-previous" />
    </>
  );
}

// ─── Table ───────────────────────────────────────────────────────────────────

/**
 * A HeroUI Table. Its body is a React Aria collection: the builder reads the
 * props of `<TableRow>` / `<TableCell>` elements and renders them itself, so a
 * row component of ours (one that calls `useForm(row)` and returns a
 * `<TableRow>`) is not accepted. The row stays a `TableRow`, and the content
 * of each cell is a component that calls `useForm(row)`: an edit of a field
 * re-renders the cells that show it.
 *
 * The sort goes straight into the table: `sortDescriptor` / `onSortChange`
 * are in React Aria's shape. A press on a header sorts by that column; a
 * press on the sorted one follows `toggle`'s cycle (asc → desc → the default).
 */
function OrdersTable({ orders, sort }: { orders: PalistorList<Order>; sort: SortProxyNode<SortKey<Order>> }) {
  const t = useTranslations("lists.orders");
  const list = useForm(orders);
  // The sort's own subscription: a sort change re-renders the table (the header's arrow).
  const s = useForm(sort);
  // Reading `isInitialLoading` asks for the list: it is true in the server's
  // HTML (the store there holds the run back) and in the browser's first
  // render, so both draw the skeleton.
  const initial = !!list.isInitialLoading;
  // keepPreviousData: a new query keeps the old rows until its first page lands.
  const previous = !!list.isPreviousData;

  return (
    <div data-testid="lists-orders-table" data-previous-data={previous ? "true" : "false"} className="space-y-2">
      {list.resolveStatus === "error" && (
        <p data-testid="lists-orders-error" role="alert" className="flex items-center gap-3 text-sm text-red-600 dark:text-red-400">
          {t("loadFailed")}
          <button data-testid="lists-orders-retry" onClick={list.reload} className={buttonClass("danger")}>
            {t("retry")}
          </button>
        </p>
      )}
      <Table
        aria-label={t("title")}
        sortDescriptor={s.sortDescriptor}
        onSortChange={s.onSortChange}
        // Dims the body cells while they show the previous query's rows.
        classNames={{ td: `transition-opacity ${previous ? "opacity-40" : ""}` }}
      >
        <TableHeader>
          {ORDER_COLUMNS.map((column) => (
            <TableColumn key={column.key} align={column.align} allowsSorting>
              {t(`columns.${column.key}`)}
            </TableColumn>
          ))}
        </TableHeader>
        <TableBody
          emptyContent={initial ? <Skeleton testId="lists-orders-skeleton" rows={3} label={t("loading")} /> : t("empty")}
        >
          {list.map((order, _index, id) => (
            <TableRow key={id} data-testid="lists-orders-row">
              {ORDER_COLUMNS.map((column) => (
                <TableCell key={column.key}>
                  <OrderCell order={order} column={column.key} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const STATUS_COLOR: Record<OrderStatus, "warning" | "primary" | "secondary" | "success" | "default"> = {
  pending: "warning",
  paid: "primary",
  shipped: "secondary",
  delivered: "success",
  cancelled: "default",
};

/** One cell of one row: its own `useForm(row)`, reading only the field of its column. */
function OrderCell({ order, column }: { order: PalistorRef<Order>; column: OrderColumn }) {
  const t = useTranslations("lists.orders");
  const format = useFormatter();
  const row = useForm(order);

  switch (column) {
    case "number":
      return <span data-testid="lists-orders-number" className="font-mono">{row.number.value}</span>;
    case "customer":
      return <span data-testid="lists-orders-customer">{row.customer.value}</span>;
    case "createdAt":
      return (
        <span data-testid="lists-orders-created" className="whitespace-nowrap">
          {format.dateTime(new Date(row.createdAt.value), { dateStyle: "medium" })}
        </span>
      );
    case "status":
      return (
        <Chip data-testid="lists-orders-row-status" size="sm" variant="flat" color={STATUS_COLOR[row.status.value]}>
          {t(`statuses.${row.status.value}`)}
        </Chip>
      );
    case "amount":
      return (
        <span data-testid="lists-orders-amount" className="font-mono">
          {format.number(row.amount.value, { style: "currency", currency: "USD" })}
        </span>
      );
  }
}

// ─── Pager ───────────────────────────────────────────────────────────────────

function OrdersPager({ orders }: { orders: PalistorList<Order> }) {
  const t = useTranslations("lists.orders");
  // The paging members are typed optional: present because the list declares `resolve.pagination`.
  const list = useForm(orders);
  const page = list.page!;
  const hasNext = !!list.hasNextPage;
  const total = list.total;
  // A new query has no total until its first page lands (also while the previous rows are kept).
  const known = total !== undefined;

  // Hover or focus on "Next" fetches the next page into the cache: the click then shows it at once.
  const prefetchNext = () => {
    if (hasNext) void list.prefetch!(page + 1);
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-zinc-600 dark:text-zinc-400">
      <button
        data-testid="lists-orders-prev"
        disabled={!list.hasPrevPage}
        onClick={list.prevPage}
        className={buttonClass("neutral")}
      >
        ← {t("prev")}
      </button>
      <button
        data-testid="lists-orders-next"
        disabled={!hasNext}
        onMouseEnter={prefetchNext}
        onFocus={prefetchNext}
        onClick={list.nextPage}
        className={buttonClass("neutral")}
      >
        {t("next")} →
      </button>
      <span data-testid="lists-orders-page-status">
        {known ? t("pageOf", { page, count: list.pageCount! }) : t("pageOfUnknown", { page })}
      </span>
      {known && (
        <span data-testid="lists-orders-total" className="text-zinc-400 dark:text-zinc-500">
          {t("total", { count: total })}
        </span>
      )}
      {list.isFetching && <Spinner testId="lists-orders-busy" />}

      <span className="ml-auto flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 whitespace-nowrap">
          {t("pageSize")}
          {/* An action, not a field: setPageSize clears the cache and loads page 1 once. */}
          <select
            data-testid="lists-orders-page-size"
            value={list.pageSize}
            onChange={(e) => list.setPageSize!(Number(e.target.value))}
            className={INPUT_CLASS.replace("w-full", "w-20")}
          >
            {ORDERS_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        {/* invalidate(page): this page goes stale and, being the current one, is fetched again — one request. */}
        <button data-testid="lists-orders-refresh" onClick={() => list.invalidate!(page)} className={buttonClass("neutral")}>
          {t("refresh")}
        </button>
      </span>
    </div>
  );
}

// ─── Footer and notes ────────────────────────────────────────────────────────

/** The URL of the last request the fake endpoint got: the filter's `param` names, the page's offset and limit. */
function LastRequest() {
  const t = useTranslations("lists.orders");
  // Module-level for the browser tab, like the counters: null on the server and in the hydrating render.
  const url = useSyncExternalStore(subscribeLastRequest, getLastRequest, () => null);

  return (
    <p>
      {t("lastRequest")}:{" "}
      <code data-testid="lists-orders-last-request" className="font-mono">
        {url ?? "—"}
      </code>
    </p>
  );
}

function Tips() {
  const t = useTranslations("lists.orders.tips");

  return (
    <ul className="list-disc pl-5 space-y-1 text-sm text-zinc-500 dark:text-zinc-400">
      <li>{t("sort")}</li>
      <li>{t("prefetch")}</li>
      <li>{t("refresh")}</li>
      <li>{t("pageSize")}</li>
      <li>{t("cache")}</li>
      <li data-testid="lists-orders-stale-time">{t("stale", { seconds: ORDERS_STALE_TIME / 1000 })}</li>
    </ul>
  );
}
