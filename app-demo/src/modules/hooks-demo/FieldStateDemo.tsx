"use client";

import { usePaymentForm } from "@/config/paymentForm";

interface FieldStateDemoProps {
  formId: string;
  fieldKey: string;
}

export function FieldStateDemo({ formId, fieldKey }: FieldStateDemoProps) {
  const { fields } = usePaymentForm(formId);
  const field = fields[fieldKey as keyof typeof fields];

  return (
    <div className="p-4 rounded-lg bg-zinc-50 dark:bg-zinc-800">
      <h3 className="font-medium text-zinc-900 dark:text-zinc-100 mb-2">
        useForm — fields.{fieldKey}
      </h3>
      <pre className="text-xs text-zinc-600 dark:text-zinc-400 overflow-auto">
        {JSON.stringify(field, null, 2)}
      </pre>
    </div>
  );
}
