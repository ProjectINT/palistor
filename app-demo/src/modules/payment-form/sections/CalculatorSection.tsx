"use client";

import { useTranslations } from "next-intl";
import { Input } from "@heroui/react";

import { Section } from "@/modules/shared/Section";
import { usePaymentForm } from "@/config/paymentForm";

interface CalculatorSectionProps {
  formId: string;
}

export function CalculatorSection({ formId }: CalculatorSectionProps) {
  const t = useTranslations();
  const { getFieldProps } = usePaymentForm(formId);

  const { value: priceValue, isVisible: priceVisible, error: priceError, ...priceProps } = getFieldProps("price");
  const { value: quantityValue, isVisible: quantityVisible, error: quantityError, ...quantityProps } = getFieldProps("quantity");
  const { value: totalValue, isVisible: totalVisible, error: totalError, ...totalProps } = getFieldProps("total");
  
  return (
    <Section title={t("sections.calculator")}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Input {...priceProps} value={priceValue?.toString() ?? ""} />
        <Input {...quantityProps} value={quantityValue?.toString() ?? ""} />
        <Input {...totalProps} value={totalValue?.toString() ?? ""} />
      </div>
    </Section>
  );
}
