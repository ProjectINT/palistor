"use client";

import { usePaymentForm } from "@/config/appConfig";

interface FieldStateDemoProps {
  fieldKey: string;
}

export function FieldStateDemo({ fieldKey }: FieldStateDemoProps) {
  const form = usePaymentForm();
  const field = (form as any)[fieldKey];

  const state = field ? {
    value: field.value,
    label: field.label,
    isVisible: field.isVisible,
    isRequired: field.isRequired,
    isDisabled: field.isDisabled,
    isReadOnly: field.isReadOnly,
    isInvalid: field.isInvalid,
    errorMessage: field.errorMessage,
  } : null;

  return (
    <div className="p-4 rounded-lg bg-zinc-50 dark:bg-zinc-800">
      <h3 className="font-medium text-zinc-900 dark:text-zinc-100 mb-2">
        form.{fieldKey} — прокси
      </h3>
      <pre className="text-xs text-zinc-600 dark:text-zinc-400 overflow-auto">
        {JSON.stringify(state, null, 2)}
      </pre>
    </div>
  );
}
