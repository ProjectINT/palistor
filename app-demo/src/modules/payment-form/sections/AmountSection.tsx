"use client";

import { useTranslations } from "next-intl";
import { Input } from "@heroui/react";

import { Section } from "@/modules/shared/Section";
import { usePaymentForm } from "@/config/paymentForm";

interface AmountSectionProps {
  formId: string;
}

export function AmountSection({ formId }: AmountSectionProps) {
  const t = useTranslations();
  const { getFieldProps } = usePaymentForm(formId);

  const { value, isVisible, error, ...fieldProps } = getFieldProps("amount");
  
  return (
    <Section title={t("sections.amount")}>
      <Input
        {...fieldProps}
        value={value?.toString() ?? ""}
        type="number"
      />
    </Section>
  );
}
