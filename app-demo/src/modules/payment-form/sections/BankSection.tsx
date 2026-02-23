"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/Input";

import { Section } from "@/modules/shared/Section";
import { usePaymentForm, fieldProps } from "@/config/paymentForm";

export function BankSection() {
  const t = useTranslations();
  const form = usePaymentForm();

  return (
    <Section title={t("sections.bankTransfer")}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input {...fieldProps(form.bankAccount)} />
        <Input {...fieldProps(form.bankBik)} />
      </div>
    </Section>
  );
}
