"use client";

import { useTranslations } from "next-intl";

import { Section } from "@/modules/shared/Section";
import { usePaymentForm } from "@/config/paymentForm";
import { Input } from "@/components/Input";

interface CalculatorSectionProps {
  formId: string;
}

export function CalculatorSection({ formId }: CalculatorSectionProps) {
  const t = useTranslations();
  const { getFieldProps } = usePaymentForm(formId);
  
  return (
    <Section title={t("sections.calculator")}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Input {...getFieldProps("price")} />
        <Input {...getFieldProps("quantity")} />
        <Input {...getFieldProps("total")} />
      </div>
    </Section>
  );
}
