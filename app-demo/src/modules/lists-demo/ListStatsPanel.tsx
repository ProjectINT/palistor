"use client";

import { Spinner } from "@heroui/react";
import { useForm } from "@palistor";
import type { PalistorList } from "@palistor";

import type { Product, User } from "@/config/catalog/types";

/** The same two lists as the sections above, read here through subscriptions of their own. */
export function ListStatsPanel({ users, products }: { users: PalistorList<User>; products: PalistorList<Product> }) {
  const u = useForm(users);
  const p = useForm(products);

  return (
    <div className="grid grid-cols-2 gap-4 text-sm">
      <Stat label="Users" count={u.length} loading={u.loading} dirty={u.dirty} />
      <Stat label="Products" count={p.length} loading={p.loading} dirty={p.dirty} />
    </div>
  );
}

function Stat({ label, count, loading, dirty }: { label: string; count: number; loading: boolean; dirty: boolean }) {
  return (
    <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800">
      <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">{label}</div>
      <div className="flex items-center gap-2 font-medium text-zinc-900 dark:text-zinc-100">
        {count} items
        {loading && <Spinner size="sm" />}
        {dirty && <span className="text-amber-500 text-xs">✏️ modified</span>}
      </div>
    </div>
  );
}
