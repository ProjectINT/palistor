"use client";

import { useTranslations } from "next-intl";
import type { FieldProxyNode } from "@palistor";

import { TextField } from "@/components/TextField";
import { Section } from "@/modules/shared/Section";

export function AmountSection({ amount }: { amount: FieldProxyNode<number> }) {
  const t = useTranslations();

  return (
    <Section title={t("sections.amount")}>
      <TextField field={amount} type="number" />
    </Section>
  );
}
