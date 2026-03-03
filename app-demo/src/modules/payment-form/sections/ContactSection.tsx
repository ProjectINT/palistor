"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/Input";

import { Section } from "@/modules/shared/Section";
import { usePaymentForm } from "@/config/paymentForm";

export function ContactSection() {
  const t = useTranslations();
  const form = usePaymentForm();

  return (
    <Section title={t("sections.contact")}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input {...form.name} />
        <Input {...form.email} type="email" />
        <div className="md:col-span-2">
          <Input {...form.phone} type="tel" />
        </div>
      </div>
    </Section>
  );
}
