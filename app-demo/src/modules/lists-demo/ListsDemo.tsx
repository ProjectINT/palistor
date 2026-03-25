"use client";

import { useTranslations } from "next-intl";
import { UsersListSection } from "./UsersListSection";
import { ProductsListSection } from "./ProductsListSection";
import { ListStatsPanel } from "./ListStatsPanel";

export function ListsDemo() {
  const t = useTranslations();

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
          {t("catalog.users")}
        </h2>
        <UsersListSection />
      </div>

      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
          {t("catalog.products")}
        </h2>
        <ProductsListSection />
      </div>

      <ListStatsPanel />
    </div>
  );
}
