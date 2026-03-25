"use client";

import { useCatalogForm } from "@/config/catalog/catalogConfig";

const CATEGORIES = [
  { value: "", label: "All" },
  { value: "electronics", label: "Electronics" },
  { value: "furniture", label: "Furniture" },
];

export function ProductsListSection() {
  const form = useCatalogForm();
  const products = form.products;

  return (
    <div className="space-y-4">
      {/* Category filter — triggers re-resolve via auto-deps */}
      <div className="flex flex-wrap gap-2">
        <span className="text-sm text-zinc-500 dark:text-zinc-400 self-center">Category:</span>
        {CATEGORIES.map((cat) => (
          <button
            key={cat.value}
            onClick={() => {
              form.categoryFilter.onValueChange(cat.value);
            }}
            className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
              form.categoryFilter.value === cat.value
                ? "bg-blue-500 text-white"
                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Loading indicator */}
      {products.loading && (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <span className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          Loading products...
        </div>
      )}

      {/* Products list */}
      <div className="space-y-1">
        {products.map((product: any, _index: number, id: string) => (
          <div
            key={id}
            className="flex justify-between items-center p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
          >
            <span className="font-medium text-zinc-900 dark:text-zinc-100">
              {product.title.value}
            </span>
            <div className="flex items-center gap-4">
              <span className="font-mono text-zinc-700 dark:text-zinc-300">
                ${product.price.value}
              </span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  product.inStock.value
                    ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                    : "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                }`}
              >
                {product.inStock.value ? "In Stock" : "Out of Stock"}
              </span>
            </div>
          </div>
        ))}
      </div>

      {!products.loading && products.length === 0 && (
        <p className="text-zinc-400 dark:text-zinc-500 text-center py-4">No products</p>
      )}

      <div className="text-sm text-zinc-500 dark:text-zinc-400">
        Total: {products.length} products
        {products.dirty && " · Modified"}
      </div>
    </div>
  );
}
