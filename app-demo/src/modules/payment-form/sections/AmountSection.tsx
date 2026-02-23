"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/Input";

import { Section } from "@/modules/shared/Section";
import { usePaymentForm, fieldProps } from "@/config/paymentForm";

export function AmountSection() {
  const t = useTranslations();
  const form = usePaymentForm();

  return (
    <Section title={t("sections.amount")}>
      <Input {...fieldProps(form.amount)} type="number" />
    </Section>
  );
}
