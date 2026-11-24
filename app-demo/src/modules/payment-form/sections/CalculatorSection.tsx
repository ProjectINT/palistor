"use client";

import { useTranslations } from "next-intl";
import type { FieldProxyNode } from "@palistor";

import { TextField } from "@/components/TextField";
import { Section } from "@/modules/shared/Section";

interface CalculatorSectionProps {
  price: FieldProxyNode<number>;
  quantity: FieldProxyNode<number>;
  total: FieldProxyNode<number>;
}

export function CalculatorSection({ price, quantity, total }: CalculatorSectionProps) {
  const t = useTranslations();

  return (
    <Section title={t("sections.calculator")}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <TextField field={price} />
        <TextField field={quantity} />
        <TextField field={total} />
      </div>
    </Section>
  );
}
