"use client";

import { useTranslations } from "next-intl";
import { useForm } from "@palistor";

import { catalogStore } from "@/config/catalog/catalogConfig";
import { ValuesJson } from "@/modules/shared";
import { AutoDepsSection } from "./AutoDepsSection";
import { LoadingStatesSection } from "./LoadingStatesSection";
import { RetrySection } from "./RetrySection";

/**
 * The Async Resolvers tab, on the same store as Lists & Entities. The only
 * component that sees `catalogStore`: each section gets the nodes it shows.
 */
export function AsyncDemo() {
  const t = useTranslations("async");
  // Only navigates: reads no state, so nothing below re-renders the tab.
  const form = useForm(catalogStore);

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
      <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-1">{t("title")}</h2>
      <p className="text-zinc-500 dark:text-zinc-400 text-sm mb-6">{t("subtitle")}</p>

      <div className="space-y-6 divide-y divide-zinc-100 dark:divide-zinc-800 [&>*:not(:first-child)]:pt-6">
        <LoadingStatesSection users={form.users} products={form.products} serverStatus={form.serverStatus} />
        <AutoDepsSection category={form.categoryFilter} products={form.products} />
        <RetrySection serverStatus={form.serverStatus} />
        <StoreValues />
      </div>
    </div>
  );
}

// A debug view of the whole store, not a form (see ValuesJson for why it does not go through useForm).
function StoreValues() {
  return (
    <div className="space-y-3">
      <h3 className="font-medium text-zinc-900 dark:text-zinc-100">Store Values (debug)</h3>
      <div className="max-h-60 overflow-auto">
        <ValuesJson store={catalogStore} />
      </div>
    </div>
  );
}
