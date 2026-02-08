"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@/modules/shared";
import { usePaymentForm } from "@/config/paymentForm";

interface StatePreviewProps {
  formId: string;
}

export function StatePreview({ formId }: StatePreviewProps) {
  const t = useTranslations();
  const { values, errors, dirty, submitting } = usePaymentForm(formId);

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6 sticky top-8">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
        {t("debug.valuesTitle")}
      </h2>

      <div className="space-y-4">
        {/* Status */}
        <div className="flex gap-2 flex-wrap">
          {dirty && <Badge color="amber">Dirty</Badge>}
          {submitting && <Badge color="blue">Submitting...</Badge>}
          {Object.keys(errors).length > 0 && (
            <Badge color="red">{Object.keys(errors).length} errors</Badge>
          )}
        </div>

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
