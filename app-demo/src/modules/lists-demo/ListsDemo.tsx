"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useForm, useStoreContext } from "@palistor";

import { catalogStore, initialCatalogContext } from "@/config/catalog/catalogConfig";
import type { CatalogContext } from "@/config/catalog/types";
import { ListStatsPanel } from "./ListStatsPanel";
import { OrdersSection } from "./OrdersSection";
import { ProductsSection } from "./ProductsSection";
import { StoreContextSection } from "./StoreContextSection";
import { UsersSection } from "./UsersSection";
import { Card } from "./ui";

// The /lists routes are built on the Cube implementation only, like /ssr: the
// same build-time flag as the header's /ssr link (next.config.ts).
const HAS_LISTS_DEMO = process.env.NEXT_PUBLIC_PALISTOR_SSR_DEMO === "1";

/**
 * The Lists & Entities tab. The only component here that sees `catalogStore`:
 * it hands every section the nodes it shows, and each component below works
 * on the node its parent gave it — a list, a row, a group or a field.
 */
export function ListsDemo() {
  const t = useTranslations();
  // Only navigates: reads no state, so no edit below re-renders the tab.
  const form = useForm(catalogStore);

  // App data the resolvers read (store.context), not form state: kept next to the store.
  const [context, setContext] = useState<CatalogContext>(initialCatalogContext);
  useStoreContext(catalogStore, context);

  return (
    <div className="space-y-6">
      {HAS_LISTS_DEMO && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400 bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900 rounded-xl px-4 py-3">
          {t("demo.listsLinkHint")}{" "}
          <Link href="/lists" className="font-medium text-blue-600 dark:text-blue-400 hover:underline">
            {t("demo.listsLink")}
          </Link>
        </p>
      )}

      <Card title={t("catalog.users")}>
        <UsersSection
          users={form.users}
          addUser={form.addUser}
          onDelete={(id) => catalogStore.delete(id)}
          onInvalidate={(id) => catalogStore.invalidate(id)}
        />
      </Card>

      <Card title={t("catalog.products")}>
        <ProductsSection products={form.products} category={form.categoryFilter} />
      </Card>

      <Card title={t("catalog.orders")}>
        <OrdersSection orders={form.orders} search={form.searchQuery} />
      </Card>

      <Card title={t("storeContext.title")} subtitle={t("storeContext.subtitle")}>
        <StoreContextSection context={context} onChange={(patch) => setContext((current) => ({ ...current, ...patch }))} />
      </Card>

      <Card title="List Stats">
        <ListStatsPanel users={form.users} products={form.products} />
      </Card>
    </div>
  );
}
