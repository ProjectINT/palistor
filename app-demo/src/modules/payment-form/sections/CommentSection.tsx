"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/Input";

import { Section } from "@/modules/shared/Section";
import { usePaymentForm } from "@/config/appConfig";

export function CommentSection() {
  const t = useTranslations();
  const form = usePaymentForm();
  
  return (
    <Section title={t("sections.comment")}>
      <Input {...form.comment} />
    </Section>
  );
}
