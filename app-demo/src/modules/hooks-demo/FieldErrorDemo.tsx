"use client";

import { usePaymentForm } from "@/config/paymentForm";

interface FieldErrorDemoProps {
  fieldKey: string;
}

export function FieldErrorDemo({ fieldKey }: FieldErrorDemoProps) {
  const form = usePaymentForm();
  const field = (form as any)[fieldKey];
  const errorMessage = field?.errorMessage;

  return (
    <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20">
      <h3 className="font-medium text-red-900 dark:text-red-100 mb-2">
        form.{fieldKey}.errorMessage
      </h3>
      <p className="text-sm text-red-700 dark:text-red-300">
        Error:{" "}
        {errorMessage ? (
          <code className="bg-red-100 dark:bg-red-800 px-1 rounded">{errorMessage}</code>
        ) : (
          "—"
        )}
      </p>
    </div>
  );
}
