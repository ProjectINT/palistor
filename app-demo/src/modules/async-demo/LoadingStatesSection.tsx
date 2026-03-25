"use client";

import { useCatalogForm } from "@/config/catalog/catalogConfig";

function StatusCard({
  label,
  loading,
  count,
  value,
}: {
  label: string;
  loading: boolean;
  count?: number;
  value?: string;
}) {
  return (
    <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800">
      <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">{label}</div>
      {loading ? (
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-zinc-600 dark:text-zinc-400">Loading...</span>
        </div>
      ) : (
        <div className="text-sm font-medium text-green-600 dark:text-green-400">
          {count !== undefined ? `${count} items` : value || "Ready"}
        </div>
      )}
    </div>
  );
}

export function LoadingStatesSection() {
  const form = useCatalogForm();

  return (
    <div className="space-y-3">
      <h3 className="font-medium text-zinc-900 dark:text-zinc-100">Loading States</h3>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Each async node (lists, groups) exposes a <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded">.loading</code> flag.
      </p>
      <div className="grid grid-cols-3 gap-3">
        <StatusCard label="Users List" loading={form.users.loading} count={form.users.length} />
        <StatusCard
          label="Products List"
          loading={form.products.loading}
          count={form.products.length}
        />
        <StatusCard
          label="Server Status"
          loading={form.serverStatus.loading}
          value={form.serverStatus.status?.value || undefined}
        />
      </div>
    </div>
  );
}
