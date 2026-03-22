"use client";

import { useTranslations } from "next-intl";

import { usePaymentForm, paymentStore } from "@/config/paymentForm";
import { useCatalogForm, catalogStore } from "@/config/catalog/catalogConfig";

export function DebugPanel() {
  const t = useTranslations();
  usePaymentForm();
  useCatalogForm();

  const paymentValues = paymentStore.getValues();
  const catalogValues = catalogStore.getValues();

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6 space-y-6">
      <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
        {t("debug.stateTitle")}
      </h2>

      {/* Payment store values */}
      <div>
        <h3 className="font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          paymentStore — {t("debug.fieldsTitle")}
        </h3>
        <div className="max-h-80 overflow-auto">
          <pre className="text-xs text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800 p-3 rounded-lg">
            {JSON.stringify(paymentValues, null, 2)}
          </pre>
        </div>
      </div>

      {/* Catalog store values */}
      <div>
        <h3 className="font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          catalogStore — lists & entities
        </h3>
        <div className="grid grid-cols-2 gap-3 mb-3 text-sm">
          <div className="p-2 rounded bg-zinc-50 dark:bg-zinc-800">
            <span className="text-zinc-500 dark:text-zinc-400">Users: </span>
            <strong>{Array.isArray(catalogValues.users) ? (catalogValues.users as unknown[]).length : 0}</strong>
          </div>
          <div className="p-2 rounded bg-zinc-50 dark:bg-zinc-800">
            <span className="text-zinc-500 dark:text-zinc-400">Products: </span>
            <strong>{Array.isArray(catalogValues.products) ? (catalogValues.products as unknown[]).length : 0}</strong>
          </div>
        </div>
        <div className="max-h-80 overflow-auto">
          <pre className="text-xs text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800 p-3 rounded-lg">
            {JSON.stringify(catalogValues, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}
