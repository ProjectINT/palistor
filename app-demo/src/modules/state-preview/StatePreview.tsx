"use client";

import { useTranslations } from "next-intl";

import { usePaymentForm, paymentStore } from "@/config/paymentForm";

export function StatePreview() {
  const t = useTranslations();
  // Подписываемся на глобальные изменения через usePaymentForm().
  // Не читаем поля из proxy — перерисовка при любом изменении (глобальный fallback).
  usePaymentForm();

  const values = paymentStore.getValues();

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6 sticky top-8">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
        {t("debug.valuesTitle")}
      </h2>

      <div className="space-y-4">
        {/* Values */}
        <div className="max-h-[60vh] overflow-auto">
          <pre className="text-xs text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800 p-3 rounded-lg">
            {JSON.stringify(values, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}
