"use client";

import { useTranslations } from "next-intl";

import { Input } from "@/components/ui";
import { Section } from "@/modules/shared/Section";
import { usePaymentForm } from "@/config/paymentForm";

interface BankSectionProps {
  formId: string;
}

export function BankSection({ formId }: BankSectionProps) {
  const t = useTranslations();
  const { getFieldProps } = usePaymentForm(formId);
  const isVisible = getFieldProps("bankAccount").isVisible;

  if (!isVisible) return null;

  return (
    <Section title={t("sections.bankTransfer")}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input {...getFieldProps("bankAccount")} />
        <Input {...getFieldProps("bankBik")} />
      </div>
    </Section>
  );
}
