"use client";

import { useTranslations } from "next-intl";

import { Input } from "@/components/ui";
import { Section } from "@/modules/shared/Section";
import { usePaymentForm } from "@/config/paymentForm";

interface CommentSectionProps {
  formId: string;
}

export function CommentSection({ formId }: CommentSectionProps) {
  const t = useTranslations();
  const { getFieldProps } = usePaymentForm(formId);

  return (
    <Section title={t("sections.comment")}>
      <Input {...getFieldProps("comment")} />
    </Section>
  );
}
