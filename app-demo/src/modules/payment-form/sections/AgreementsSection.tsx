"use client";

import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/Checkbox";

import { Section } from "@/modules/shared/Section";
import { usePaymentForm, fieldProps } from "@/config/paymentForm";

export function AgreementsSection() {
  const t = useTranslations();
  const form = usePaymentForm();

  return (
    <Section title={t("sections.agreements")}>
      <div className="space-y-3">
        <Checkbox
          {...fieldProps(form.agreeTerms)}
          isSelected={Boolean(form.agreeTerms.value)}
          onChange={(e) => { form.agreeTerms.value = e.target.checked; }}
        >
          {form.agreeTerms.label}
        </Checkbox>
        <Checkbox
          {...fieldProps(form.newsletter)}
          isSelected={Boolean(form.newsletter.value)}
          onChange={(e) => { form.newsletter.value = e.target.checked; }}
        >
          {form.newsletter.label}
        </Checkbox>
      </div>
    </Section>
  );
}
