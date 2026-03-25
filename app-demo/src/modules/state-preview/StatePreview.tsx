"use client";

import { useTranslations } from "next-intl";

import { usePaymentForm, paymentStore } from "@/config/appConfig";
import { useCatalogForm, catalogStore } from "@/config/catalog/catalogConfig";
import type { TabType } from "@/modules/header";

interface StatePreviewProps {
  activeTab: TabType;
}

export function StatePreview({ activeTab }: StatePreviewProps) {
  const t = useTranslations();

  const isCatalogTab = activeTab === "lists" || activeTab === "async";

  // Subscribe to the relevant store
  usePaymentForm();
  useCatalogForm();

  const values = isCatalogTab ? catalogStore.getValues() : paymentStore.getValues();

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6 sticky top-8">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
        {t("debug.valuesTitle")}
      </h2>
      <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-4">
        {isCatalogTab ? "catalogStore" : "paymentStore"}
      </p>

      <div className="space-y-4">
        <div className="max-h-[60vh] overflow-auto">
          <pre className="text-xs text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800 p-3 rounded-lg">
            {JSON.stringify(values, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}
