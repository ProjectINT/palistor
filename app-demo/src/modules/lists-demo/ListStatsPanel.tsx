"use client";

import { useCatalogForm } from "@/config/catalog/catalogConfig";

export function ListStatsPanel() {
  const form = useCatalogForm();

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
      <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-3">List Stats</h3>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800">
          <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">Users</div>
          <div className="font-medium text-zinc-900 dark:text-zinc-100">
            {form.users.length} items
            {form.users.loading && (
              <span className="ml-2 text-blue-500">
                <span className="inline-block w-2.5 h-2.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </span>
            )}
            {form.users.dirty && (
              <span className="ml-1 text-amber-500 text-xs">✏️ modified</span>
            )}
          </div>
        </div>
        <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800">
          <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">Products</div>
          <div className="font-medium text-zinc-900 dark:text-zinc-100">
            {form.products.length} items
            {form.products.loading && (
              <span className="ml-2 text-blue-500">
                <span className="inline-block w-2.5 h-2.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </span>
            )}
            {form.products.dirty && (
              <span className="ml-1 text-amber-500 text-xs">✏️ modified</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
