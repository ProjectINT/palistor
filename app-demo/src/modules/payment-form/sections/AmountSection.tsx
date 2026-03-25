"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/Input";

import { Section } from "@/modules/shared/Section";
import { usePaymentForm } from "@/config/appConfig";

export function AmountSection() {
  const t = useTranslations();
  const form = usePaymentForm();

  return (
    <Section title={t("sections.amount")}>
      <Input {...form.amount} type="number" />
    </Section>
  );
}
