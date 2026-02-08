"use client";

import { usePaymentForm } from "@/config/paymentForm";

interface FieldErrorDemoProps {
  formId: string;
  fieldKey: string;
}

export function FieldErrorDemo({ formId, fieldKey }: FieldErrorDemoProps) {
  const { fields } = usePaymentForm(formId);
  const error = fields[fieldKey as keyof typeof fields]?.error;

  return (
    <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20">
      <h3 className="font-medium text-red-900 dark:text-red-100 mb-2">
        useForm — error(&quot;{fieldKey}&quot;)
      </h3>
      <p className="text-sm text-red-700 dark:text-red-300">
        Error:{" "}
        {error ? (
          <code className="bg-red-100 dark:bg-red-800 px-1 rounded">{error}</code>
        ) : (
          "—"
        )}
      </p>
    </div>
  );
}
