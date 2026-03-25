"use client";

import { useTranslations } from "next-intl";
import { Select, type SelectOption } from "@/components/Select";

import { Section } from "@/modules/shared/Section";
import { PAYMENT_TYPE_OPTIONS } from "../constants";
import { usePaymentForm, type PaymentType } from "@/config/appConfig";

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
        options={options}
        renderLabel={(option: SelectOption) => t(option.label)}
        selectedKeys={form.paymentType.value ? [form.paymentType.value] : []}
        onSelectionChange={(keys: Set<string>) => {
          const value = Array.from(keys)[0] as PaymentType;
          form.paymentType.value = value;
        }}
        {...form.paymentType}
      />
    </Section>
  );
}
