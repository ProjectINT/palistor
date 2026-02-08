"use client";

import { useTranslations } from "next-intl";

import { Input } from "@/components/ui";
import { Section } from "@/modules/shared/Section";
import { usePaymentForm } from "@/config/paymentForm";

interface CardSectionProps {
  formId: string;
}

export function CardSection({ formId }: CardSectionProps) {
  const t = useTranslations();
  const { getFieldProps } = usePaymentForm(formId);
  const isVisible = getFieldProps("cardNumber").isVisible;

  if (!isVisible) return null;

  return (
    <Section title={t("sections.cardDetails")}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-3">
          <Input {...getFieldProps("cardNumber")} />
        </div>
        <Input {...getFieldProps("cardExpiry")} />
        <Input {...getFieldProps("cardCvv")} />
      </div>
    </Section>
  );
}
