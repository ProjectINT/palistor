"use client";

import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/Checkbox";

import { Section } from "@/modules/shared/Section";
import { usePaymentForm } from "@/config/paymentForm";

interface AgreementsSectionProps {
  formId: string;
}

export function AgreementsSection({ formId }: AgreementsSectionProps) {
  const t = useTranslations();
  const { getFieldProps } = usePaymentForm(formId);

  const agreeTermsProps = getFieldProps("agreeTerms");
  const newsletterProps = getFieldProps("newsletter");
  
  return (
    <Section title={t("sections.agreements")}>
      <div className="space-y-3">
        <Checkbox
          {...agreeTermsProps}
          isSelected={agreeTermsProps.value}
        >
          {agreeTermsProps.label}
        </Checkbox>
        <Checkbox
          {...newsletterProps}
          isSelected={newsletterProps.value}
        >
          {newsletterProps.label}
        </Checkbox>
      </div>
    </Section>
  );
}
