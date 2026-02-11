"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/Button";

import { usePaymentForm } from "@/config/paymentForm";

interface FormActionsProps {
  formId: string;
}

export function FormActions({ formId }: FormActionsProps) {
  const t = useTranslations();
  const { submit, reset, submitting, dirty } = usePaymentForm(formId);

  return (
    <div className="flex gap-4 pt-4 border-t border-zinc-200 dark:border-zinc-800">
      <Button
        type="submit"
        color="primary"
        isLoading={submitting}
        onClick={submit}
      >
        {t("buttons.pay")}
      </Button>
      <Button
        type="button"
        color="default"
        variant="flat"
        onClick={() => reset()}
      >
        {t("buttons.reset")}
      </Button>
      {dirty && (
        <span className="flex items-center text-sm text-amber-600 dark:text-amber-400">
          ⚠️ {t("form.unsavedChanges")}
        </span>
      )}
    </div>
  );
}
