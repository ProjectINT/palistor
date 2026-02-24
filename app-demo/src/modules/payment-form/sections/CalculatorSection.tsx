"use client";

import { useTranslations } from "next-intl";

import { Section } from "@/modules/shared/Section";
import { usePaymentForm } from "@/config/paymentForm";
import { Input } from "@/components/Input";

export function CalculatorSection() {
  const t = useTranslations();
  const form = usePaymentForm();

  return (
    <Section title={t("sections.calculator")}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Input {...form.price} />
        <Input {...form.quantity} />
        <Input {...form.total} />
      </div>
    </Section>
  );
}
