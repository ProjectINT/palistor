"use client";

import { useTranslations } from "next-intl";

import { Input } from "@/components/ui";
import { Section } from "@/modules/shared/Section";
import { usePaymentForm } from "@/config/paymentForm";

interface ContactSectionProps {
  formId: string;
}

export function ContactSection({ formId }: ContactSectionProps) {
  const t = useTranslations();
  const { getFieldProps } = usePaymentForm(formId);

  return (
    <Section title={t("sections.contact")}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input {...getFieldProps("name")} />
        <Input {...getFieldProps("email")} type="email" />
        <div className="md:col-span-2">
          <Input {...getFieldProps("phone")} type="tel" />
        </div>
      </div>
    </Section>
  );
}
