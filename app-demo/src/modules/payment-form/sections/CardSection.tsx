"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/Input";

import { Section } from "@/modules/shared/Section";
import { usePaymentForm } from "@/config/appConfig";

export function CardSection() {
  const t = useTranslations();
  const form = usePaymentForm();

  return (
    <Section title={t("sections.cardDetails")}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-3">
          <Input {...form.cardNumber} />
        </div>
        <Input {...form.cardExpiry} />
        <Input {...form.cardCvv} />
      </div>
    </Section>
  );
}
