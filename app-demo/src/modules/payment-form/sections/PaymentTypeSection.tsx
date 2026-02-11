"use client";

import { useTranslations } from "next-intl";
import { Select, SelectItem } from "@heroui/react";

import { Section } from "@/modules/shared/Section";
import { PAYMENT_TYPE_OPTIONS } from "../constants";
import { usePaymentForm, type PaymentType } from "@/config/paymentForm";

interface PaymentTypeSectionProps {
  formId: string;
}

export function PaymentTypeSection({ formId }: PaymentTypeSectionProps) {
  const t = useTranslations();
  const { getFieldProps, setValue } = usePaymentForm(formId);

  const paymentTypeProps = getFieldProps("paymentType");
  
  return (
    <Section title={t("sections.paymentType")}>
      <Select
        {...paymentTypeProps}
        selectedKeys={paymentTypeProps.value ? [paymentTypeProps.value] : []}
        onSelectionChange={(keys) => {
          const value = Array.from(keys)[0] as PaymentType;
          setValue("paymentType", value);
        }}
      >
        {PAYMENT_TYPE_OPTIONS.map((option) => (
          <SelectItem key={option.value}>
            {t(option.label)}
          </SelectItem>
        ))}
      </Select>
    </Section>
  );
}
