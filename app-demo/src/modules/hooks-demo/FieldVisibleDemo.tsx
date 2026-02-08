"use client";

import { usePaymentForm } from "@/config/paymentForm";

interface FieldVisibleDemoProps {
  formId: string;
  fieldKey: string;
}

export function FieldVisibleDemo({ formId, fieldKey }: FieldVisibleDemoProps) {
  const { fields } = usePaymentForm(formId);
  const isVisible = fields[fieldKey as keyof typeof fields]?.isVisible ?? true;

  return (
    <div className="p-4 rounded-lg bg-green-50 dark:bg-green-900/20">
      <h3 className="font-medium text-green-900 dark:text-green-100 mb-2">
        useForm — isVisible(&quot;{fieldKey}&quot;)
      </h3>
      <p className="text-sm text-green-700 dark:text-green-300">
        isVisible:{" "}
        <span className={isVisible ? "text-green-600" : "text-red-600"}>
          {String(isVisible)}
        </span>
      </p>
    </div>
  );
}
