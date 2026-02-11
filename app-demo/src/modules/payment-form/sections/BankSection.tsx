"use client";

import { useTranslations } from "next-intl";
import { Input } from "@heroui/react";

import { Section } from "@/modules/shared/Section";
import { usePaymentForm } from "@/config/paymentForm";

interface BankSectionProps {
  formId: string;
}

export function BankSection({ formId }: BankSectionProps) {
  const t = useTranslations();
  const { getFieldProps } = usePaymentForm(formId);
  const bankAccountProps = getFieldProps("bankAccount");
  const bankBikProps = getFieldProps("bankBik");
  const isVisible = bankAccountProps.isVisible;

  if (!isVisible) return null;

  return (
    <Section title={t("sections.bankTransfer")}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input {...bankAccountProps} />
        <Input {...bankBikProps} />
      </div>
    </Section>
  );
}
