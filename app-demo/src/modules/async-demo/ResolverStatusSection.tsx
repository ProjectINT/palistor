"use client";

import { useCatalogForm, catalogStore } from "@/config/catalog/catalogConfig";

export function ResolverStatusSection() {
  useCatalogForm(); // subscribe to store updates

  const values = catalogStore.getValues();

  return (
    <div className="space-y-3">
      <h3 className="font-medium text-zinc-900 dark:text-zinc-100">Store Values (debug)</h3>
      <div className="max-h-60 overflow-auto rounded-lg bg-zinc-50 dark:bg-zinc-800 p-3">
        <pre className="text-xs text-zinc-600 dark:text-zinc-400">
          {JSON.stringify(values, null, 2)}
        </pre>
      </div>
    </div>
  );
}
