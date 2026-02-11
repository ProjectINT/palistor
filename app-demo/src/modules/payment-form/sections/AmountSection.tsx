"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/Input";

import { Section } from "@/modules/shared/Section";
import { usePaymentForm } from "@/config/paymentForm";

interface AmountSectionProps {
  formId: string;
}

export function AmountSection({ formId }: AmountSectionProps) {
  const t = useTranslations();
  const { getFieldProps } = usePaymentForm(formId);
  
  return (
    <Section title={t("sections.amount")}>
      <Input {...getFieldProps("amount")} type="number" />
    </Section>
  );
}
