"use client";

import { useTranslations } from "next-intl";

import { Checkbox } from "@/components/ui";
import { Section } from "@/modules/shared/Section";
import { usePaymentForm } from "@/config/paymentForm";

interface AgreementsSectionProps {
  formId: string;
}

export function AgreementsSection({ formId }: AgreementsSectionProps) {
  const t = useTranslations();
  const { getFieldProps } = usePaymentForm(formId);

  return (
    <Section title={t("sections.agreements")}>
      <div className="space-y-3">
        <Checkbox {...getFieldProps("agreeTerms")} />
        <Checkbox {...getFieldProps("newsletter")} />
      </div>
    </Section>
  );
}
