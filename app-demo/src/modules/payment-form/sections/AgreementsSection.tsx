"use client";

import { useTranslations } from "next-intl";
import { Checkbox } from "@heroui/react";

import { Section } from "@/modules/shared/Section";
import { usePaymentForm } from "@/config/paymentForm";

interface AgreementsSectionProps {
  formId: string;
}

export function AgreementsSection({ formId }: AgreementsSectionProps) {
  const t = useTranslations();
  const { getFieldProps } = usePaymentForm(formId);

  const { isVisible: agreeVisible, error: agreeError, value: agreeValue, ...agreeTermsProps } = getFieldProps("agreeTerms");
  const { value: newsletterValue, isVisible: newsletterVisible, error: newsletterError, ...newsletterProps } = getFieldProps("newsletter");
  
  return (
    <Section title={t("sections.agreements")}>
      <div className="space-y-3">
        <Checkbox
          {...agreeTermsProps}
          isSelected={agreeValue}
        >
          {agreeTermsProps.label}
        </Checkbox>
        <Checkbox
          {...newsletterProps}
          isSelected={newsletterValue}
        >
          {newsletterProps.label}
        </Checkbox>
      </div>
    </Section>
  );
}
