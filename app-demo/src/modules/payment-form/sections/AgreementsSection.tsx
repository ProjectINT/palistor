"use client";

import { useTranslations } from "next-intl";
import type { FieldProxyNode } from "@palistor";

import { CheckboxField } from "@/components/CheckboxField";
import { Section } from "@/modules/shared/Section";

interface AgreementsSectionProps {
  agreeTerms: FieldProxyNode<boolean>;
  newsletter: FieldProxyNode<boolean>;
}

export function AgreementsSection({ agreeTerms, newsletter }: AgreementsSectionProps) {
  const t = useTranslations();

  return (
    <Section title={t("sections.agreements")}>
      <div className="space-y-3">
        <CheckboxField field={agreeTerms} />
        <CheckboxField field={newsletter} />
      </div>
    </Section>
  );
}
