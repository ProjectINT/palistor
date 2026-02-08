"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@/modules/shared";
import { usePaymentForm } from "@/config/paymentForm";

interface DebugPanelProps {
  formId: string;
}

export function DebugPanel({ formId }: DebugPanelProps) {
  const t = useTranslations();
  const { fields, errors, dirty, submitting, getVisibleFields } = usePaymentForm(formId);

  const visibleFields = getVisibleFields();

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6 space-y-6">
      <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
        {t("debug.stateTitle")}
      </h2>

      {/* Meta */}
      <div>
        <h3 className="font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          {t("debug.metaTitle")}
        </h3>
        <div className="flex gap-4 flex-wrap">
          <Badge color={dirty ? "amber" : "zinc"}>dirty: {String(dirty)}</Badge>
          <Badge color={submitting ? "blue" : "zinc"}>
            submitting: {String(submitting)}
          </Badge>
          <Badge color="green">visibleFields: {visibleFields.length}</Badge>
        </div>
      </div>

      {/* Visible Fields */}
      <div>
        <h3 className="font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          getVisibleFields()
        </h3>
        <div className="flex gap-2 flex-wrap">
          {visibleFields.map((key) => (
            <Badge key={key} color="blue">
              {key}
            </Badge>
          ))}
        </div>
      </div>

      {/* Errors */}
      {Object.keys(errors).length > 0 && (
        <div>
          <h3 className="font-medium text-red-700 dark:text-red-300 mb-2">
            {t("debug.errorsTitle")}
          </h3>
          <pre className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg overflow-auto">
            {JSON.stringify(errors, null, 2)}
          </pre>
        </div>
      )}

      {/* Field States */}
      <div>
        <h3 className="font-medium text-zinc-700 dark:text-zinc-300 mb-2">
          {t("debug.fieldsTitle")} (ComputedFieldState)
        </h3>
        <div className="max-h-96 overflow-auto">
          <pre className="text-xs text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800 p-3 rounded-lg">
            {JSON.stringify(fields, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}
