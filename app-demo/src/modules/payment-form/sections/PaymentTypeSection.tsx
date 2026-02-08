"use client";

import { useTranslations } from "next-intl";

import { Select } from "@/components/ui";
import { Section } from "@/modules/shared/Section";
import { PAYMENT_TYPE_OPTIONS } from "../constants";
import { usePaymentForm, type PaymentType } from "@/config/paymentForm";

interface PaymentTypeSectionProps {
  formId: string;
}

export function PaymentTypeSection({ formId }: PaymentTypeSectionProps) {
  const t = useTranslations();
  const { getFieldProps, setValue } = usePaymentForm(formId);

  return (
    <Section title={t("sections.paymentType")}>
      <Select
        {...getFieldProps("paymentType")}
        options={PAYMENT_TYPE_OPTIONS.map((o) => ({
          ...o,
          label: t(o.label),
        }))}
        onValueChange={(v) => setValue("paymentType", v as PaymentType)}
      />
    </Section>
  );
}
