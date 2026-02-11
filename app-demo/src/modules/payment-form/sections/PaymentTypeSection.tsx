"use client";

import { useTranslations } from "next-intl";
import { Select, type SelectOption } from "@/components/Select";

import { Section } from "@/modules/shared/Section";
import { PAYMENT_TYPE_OPTIONS } from "../constants";
import { usePaymentForm, type PaymentType } from "@/config/paymentForm";

interface PaymentTypeSectionProps {
  formId: string;
}

export function PaymentTypeSection({ formId }: PaymentTypeSectionProps) {
  const t = useTranslations();
  const { getFieldProps } = usePaymentForm(formId);

  const paymentTypeProps = getFieldProps("paymentType");

  const options: SelectOption[] = PAYMENT_TYPE_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
  }));
  
  return (
    <Section title={t("sections.paymentType")}>
      <Select
        {...paymentTypeProps}
        options={options}
        renderLabel={(option) => t(option.label)}
        selectedKeys={paymentTypeProps.value ? [paymentTypeProps.value] : []}
        onSelectionChange={(keys) => {
          const value = Array.from(keys)[0] as PaymentType;
          paymentTypeProps.onValueChange(value);
        }}
      />
    </Section>
  );
}
