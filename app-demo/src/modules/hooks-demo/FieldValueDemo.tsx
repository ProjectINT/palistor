"use client";

import { usePaymentForm } from "@/config/appConfig";

interface FieldValueDemoProps {
  fieldKey: string;
}

export function FieldValueDemo({ fieldKey }: FieldValueDemoProps) {
  const form = usePaymentForm();
  const value = (form as any)[fieldKey]?.value;

  return (
    <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20">
      <h3 className="font-medium text-blue-900 dark:text-blue-100 mb-2">
        form.{fieldKey}.value
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
