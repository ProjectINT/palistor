"use client";

import { usePaymentForm } from "@/config/paymentForm";

interface FieldValueDemoProps {
  formId: string;
  fieldKey: string;
}

export function FieldValueDemo({ formId, fieldKey }: FieldValueDemoProps) {
  const { values } = usePaymentForm(formId);
  const value = values[fieldKey as keyof typeof values];

  return (
    <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20">
      <h3 className="font-medium text-blue-900 dark:text-blue-100 mb-2">
        useForm — value(&quot;{fieldKey}&quot;)
      </h3>
      <p className="text-sm text-blue-700 dark:text-blue-300">
        Value:{" "}
        <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">
          {JSON.stringify(value)}
        </code>
      </p>
    </div>
  );
}
