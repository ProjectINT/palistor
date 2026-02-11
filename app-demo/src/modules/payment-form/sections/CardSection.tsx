"use client";

import { useTranslations } from "next-intl";
import { Input } from "@heroui/react";

import { Section } from "@/modules/shared/Section";
import { usePaymentForm } from "@/config/paymentForm";

interface CardSectionProps {
  formId: string;
}

export function CardSection({ formId }: CardSectionProps) {
  const t = useTranslations();
  const { getFieldProps } = usePaymentForm(formId);
  const cardNumberProps = getFieldProps("cardNumber");
  const cardExpiryProps = getFieldProps("cardExpiry");
  const cardCvvProps = getFieldProps("cardCvv");
  const isVisible = cardNumberProps.isVisible;

  if (!isVisible) return null;

  return (
    <Section title={t("sections.cardDetails")}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-3">
          <Input {...cardNumberProps} />
        </div>
        <Input {...cardExpiryProps} />
        <Input {...cardCvvProps} />
      </div>
    </Section>
  );
}
