"use client";

import { useTranslations } from "next-intl";

import { usePaymentForm, paymentStore } from "@/config/paymentForm";

export function DebugPanel() {
  const t = useTranslations();
  // Вызываем usePaymentForm() чтобы подписаться на любые изменения store.
  // Без чтения полей из proxy — подписка идёт на глобальную версию (перерисовка
  // при любом изменении), что и нужно для debug-панели.
  usePaymentForm();

  const values = paymentStore.getValues();

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6 space-y-6">
      <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
        {t("debug.stateTitle")}
      </h2>

      {/* Values */}
      <div>
        <h3 className="font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          {t("debug.fieldsTitle")} — store.getValues()
        </h3>
        <div className="max-h-96 overflow-auto">
          <pre className="text-xs text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800 p-3 rounded-lg">
            {JSON.stringify(values, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}
