"use client";

import { useTranslations } from "next-intl";
import { Button, Chip, Spinner } from "@heroui/react";
import { useForm } from "@palistor";
import type { FieldProxyNode, PalistorList, PalistorRef } from "@palistor";

import { TextField } from "@/components/TextField";
import type { Order } from "@/config/catalog/types";
import { Hint, ListError } from "./ui";

/**
 * A paginated list: the resolver runs once per page and every page is cached,
 * so going back to a page shows it without a request. The search field is
 * read by the resolver: typing starts a new query at page 1.
 */
export function OrdersSection({ orders, search }: { orders: PalistorList<Order>; search: FieldProxyNode<string> }) {
  const t = useTranslations("catalog");
  const list = useForm(orders);

  return (
    <div className="space-y-4">
      <Hint>{t("ordersHint")}</Hint>

      <TextField field={search} size="sm" />

      {list.resolveStatus === "error" && <ListError error={list.error} onRetry={() => list.refetch?.()} />}

      {/* A skeleton for the empty first load only; a page change keeps the rows on screen. */}
      {list.isInitialLoading ? (
        <div className="space-y-1">
          {Array.from({ length: list.pageSize ?? 0 }, (_, i) => (
            <div key={i} className="h-11 rounded-lg bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          {list.map((order, _index, id) => (
            <OrderRow key={id} order={order} onRemove={() => list.remove(id)} />
          ))}
          {list.length === 0 && <p className="text-zinc-400 dark:text-zinc-500 text-center py-4">{t("noOrders")}</p>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
        <Button size="sm" variant="flat" isDisabled={!list.hasPrevPage || list.isFetching} onPress={() => list.prevPage?.()}>
          ← {t("prevPage")}
        </Button>
        <span className="flex items-center gap-2">
          {t("pageOf", { page: list.page ?? 1, count: list.pageCount ?? 0 })}
          {list.isFetching && <Spinner size="sm" />}
        </span>
        <Button size="sm" variant="flat" isDisabled={!list.hasNextPage || list.isFetching} onPress={() => list.nextPage?.()}>
          {t("nextPage")} →
        </Button>
        <span className="ml-auto">
          {t("ordersTotal", { count: list.total ?? 0 })}
          {list.dirty && <span className="ml-2 text-amber-500">● {t("listDirty")}</span>}
        </span>
        <Button size="sm" variant="flat" isDisabled={list.isFetching} onPress={() => list.refetch?.()}>
          ↻ {t("refetch")}
        </Button>
      </div>
    </div>
  );
}

function OrderRow({ order, onRemove }: { order: PalistorRef<Order>; onRemove: () => void }) {
  const row = useForm(order);

  return (
    <div className="flex justify-between items-center p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
      <span className="font-medium text-zinc-900 dark:text-zinc-100">{row.title.value}</span>
      <div className="flex items-center gap-4">
        <Chip size="sm" variant="flat">
          {row.status.value}
        </Chip>
        <span className="font-mono text-zinc-700 dark:text-zinc-300">${row.amount.value}</span>
        <Button size="sm" variant="light" isIconOnly title="Remove from this page (a local edit)" onPress={onRemove}>
          ✕
        </Button>
      </div>
    </div>
  );
}
