"use client";

import { useTranslations } from "next-intl";
import { useCatalogForm } from "@/config/catalog/catalogConfig";

/**
 * Paginated list demo: `orders` declares `resolve.pagination` — the resolver
 * is called once per page and every page is cached. Prev/Next over a cached
 * page is a synchronous projection (watch the request counter stay put);
 * typing into the search changes the query key and refetches page 1 once.
 */
export function OrdersPagedSection() {
  const t = useTranslations();
  const form = useCatalogForm();
  const orders = form.orders;

  return (
    <div className="space-y-4">
      <div className="text-xs text-zinc-400 dark:text-zinc-500 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg px-3 py-2">
        {t("catalog.ordersHint")}
      </div>

      {/* Search — an auto-dep of the resolver: a change re-keys the cache */}
      <input
        value={form.searchQuery.value}
        onChange={(e) => form.searchQuery.onValueChange(e.target.value)}
        placeholder={form.searchQuery.placeholder}
        className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-zinc-900 dark:text-zinc-100"
      />

      {/* Rows */}
      {orders.isInitialLoading ? (
        <div className="space-y-1">
          {Array.from({ length: orders.pageSize }, (_, i) => (
            <div key={i} className="h-11 rounded-lg bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          {orders.map((order: any, _index: number, id: string) => (
            <div
              key={id}
              className="flex justify-between items-center p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
            >
              <span className="font-medium text-zinc-900 dark:text-zinc-100">{order.title.value}</span>
              <div className="flex items-center gap-4">
                <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300">
                  {order.status.value}
                </span>
                <span className="font-mono text-zinc-700 dark:text-zinc-300">${order.amount.value}</span>
                <button
                  onClick={() => orders.remove(id)}
                  className="text-xs text-zinc-400 hover:text-red-500 transition-colors"
                  title={t("catalog.removeUser")}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
          {orders.length === 0 && (
            <p className="text-zinc-400 dark:text-zinc-500 text-center py-4">{t("catalog.noOrders")}</p>
          )}
        </div>
      )}

      {/* Pager — reads only page / pageCount / hasPrevPage / hasNextPage / isFetching */}
      <div className="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
        <button
          disabled={!orders.hasPrevPage || orders.isFetching}
          onClick={() => orders.prevPage()}
          className="px-3 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-40 transition-colors"
        >
          ← {t("catalog.prevPage")}
        </button>
        <span>
          {t("catalog.pageOf", { page: orders.page ?? 1, count: orders.pageCount ?? 0 })}
          {orders.isFetching && (
            <span className="ml-2 inline-block w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin align-middle" />
          )}
        </span>
        <button
          disabled={!orders.hasNextPage || orders.isFetching}
          onClick={() => orders.nextPage()}
          className="px-3 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-40 transition-colors"
        >
          {t("catalog.nextPage")} →
        </button>
        <span className="ml-auto">
          {t("catalog.ordersTotal", { count: orders.total ?? 0 })}
          {orders.dirty && <span className="ml-2 text-amber-500">● {t("catalog.listDirty")}</span>}
        </span>
        <button
          onClick={() => orders.refetch()}
          disabled={orders.isFetching}
          className="px-3 py-1 text-xs rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50 transition-colors"
        >
          ↻ {t("catalog.refetch")}
        </button>
      </div>
    </div>
  );
}
