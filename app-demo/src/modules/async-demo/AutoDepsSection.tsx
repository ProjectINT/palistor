"use client";

import { useForm } from "@palistor";
import type { FieldProxyNode, PalistorList } from "@palistor";

import type { Product } from "@/config/catalog/types";
import { CategoryFilter } from "@/modules/lists-demo/CategoryFilter";
import { Code } from "./Code";

/** No `deps` in the config: the products resolver re-runs because it read `categoryFilter`. */
export function AutoDepsSection({ category, products }: { category: FieldProxyNode<string>; products: PalistorList<Product> }) {
  const filter = useForm(category);
  const list = useForm(products);

  return (
    <div className="space-y-3">
      <h3 className="font-medium text-zinc-900 dark:text-zinc-100">Auto-Dependencies</h3>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        The products resolver reads <Code>values.categoryFilter</Code> — Palistor tracks that read and runs the
        resolver again when the filter changes.
      </p>

      <CategoryFilter field={category} />

      <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800 text-sm space-y-1">
        <div>
          Current filter: <code className="bg-zinc-200 dark:bg-zinc-700 px-1 rounded">{filter.value || "(none)"}</code>
        </div>
        <div>
          Products:{" "}
          {list.loading ? (
            <span className="text-blue-500">re-fetching...</span>
          ) : (
            <span className="text-green-600 dark:text-green-400">{list.length} loaded</span>
          )}
        </div>
      </div>
    </div>
  );
}
