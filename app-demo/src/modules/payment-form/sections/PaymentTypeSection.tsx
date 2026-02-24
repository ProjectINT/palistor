"use client";

import { useTranslations } from "next-intl";
import { Select, type SelectOption } from "@/components/Select";

import { Section } from "@/modules/shared/Section";
import { PAYMENT_TYPE_OPTIONS } from "../constants";
import { usePaymentForm, type PaymentType } from "@/config/paymentForm";

export function PaymentTypeSection() {
  const t = useTranslations();
  const form = usePaymentForm();

  const options: SelectOption[] = PAYMENT_TYPE_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
  }));

  return (
    <Section title={t("sections.paymentType")}>
      <Select
        {...form.paymentType}
        options={options}
        renderLabel={(option) => t(option.label)}
        selectedKeys={form.paymentType.value ? [form.paymentType.value] : []}
        onSelectionChange={(keys) => {
          const value = Array.from(keys)[0] as PaymentType;
          form.paymentType.value = value;
        }}
      />
    </Section>
  );
}
