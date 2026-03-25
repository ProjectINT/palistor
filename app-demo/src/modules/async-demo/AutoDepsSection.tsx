"use client";

import { useCatalogForm } from "@/config/catalog/catalogConfig";

export function AutoDepsSection() {
  const form = useCatalogForm();

  return (
    <div className="space-y-3">
      <h3 className="font-medium text-zinc-900 dark:text-zinc-100">Auto-Dependencies</h3>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        The products resolver reads <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded">values.categoryFilter</code> —
        Palistor tracks that access and automatically re-triggers the resolver when the filter changes.
      </p>

      <div className="flex flex-wrap gap-2">
        {["", "electronics", "furniture"].map((cat) => (
          <button
            key={cat}
            onClick={() => {
              form.categoryFilter.onValueChange(cat);
            }}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              form.categoryFilter.value === cat
                ? "bg-blue-500 text-white"
                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            }`}
          >
            {cat || "All"}
          </button>
        ))}
      </div>

      <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800 text-sm space-y-1">
        <div>
          Current filter:{" "}
          <code className="bg-zinc-200 dark:bg-zinc-700 px-1 rounded">
            {form.categoryFilter.value || "(none)"}
          </code>
        </div>
        <div>
          Products:{" "}
          {form.products.loading ? (
            <span className="text-blue-500">re-fetching...</span>
          ) : (
            <span className="text-green-600 dark:text-green-400">
              {form.products.length} loaded
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
