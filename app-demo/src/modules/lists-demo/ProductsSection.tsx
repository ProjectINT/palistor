"use client";

import { Chip, Spinner } from "@heroui/react";
import { useForm } from "@palistor";
import type { FieldProxyNode, PalistorList, PalistorRef } from "@palistor";

import type { Product } from "@/config/catalog/types";
import { CategoryFilter } from "./CategoryFilter";
import { ListError } from "./ui";

/** A list whose resolver reads a form field: changing the field re-fetches it. */
export function ProductsSection({ products, category }: { products: PalistorList<Product>; category: FieldProxyNode<string> }) {
  const list = useForm(products);
  const count = list.length; // starts the lazy load

  return (
    <div className="space-y-4">
      <CategoryFilter field={category} />

      {list.loading && (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Spinner size="sm" />
          Loading products...
        </div>
      )}

      {list.resolveStatus === "error" ? (
        <ListError error={list.error} onRetry={() => list.reload()} />
      ) : (
        <div className="space-y-1">
          {list.map((product, _index, id) => (
            <ProductRow key={id} product={product} />
          ))}
        </div>
      )}
      {list.resolveStatus === "resolved" && count === 0 && (
        <p className="text-zinc-400 dark:text-zinc-500 text-center py-4">No products</p>
      )}

      <div className="text-sm text-zinc-500 dark:text-zinc-400">Total: {count} products</div>
    </div>
  );
}

function ProductRow({ product }: { product: PalistorRef<Product> }) {
  const row = useForm(product);

  return (
    <div className="flex justify-between items-center p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
      <span className="font-medium text-zinc-900 dark:text-zinc-100">{row.title.value}</span>
      <div className="flex items-center gap-4">
        <span className="font-mono text-zinc-700 dark:text-zinc-300">${row.price.value}</span>
        <Chip size="sm" variant="flat" color={row.inStock.value ? "success" : "danger"}>
          {row.inStock.value ? "In Stock" : "Out of Stock"}
        </Chip>
      </div>
    </div>
  );
}
