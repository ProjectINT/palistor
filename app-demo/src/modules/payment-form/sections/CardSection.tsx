"use client";

import { useTranslations } from "next-intl";
import type { FieldProxyNode } from "@palistor";

import { TextField } from "@/components/TextField";
import { BranchSection } from "./BranchSection";

interface CardSectionProps {
  cardNumber: FieldProxyNode<string>;
  cardExpiry: FieldProxyNode<string>;
  cardCvv: FieldProxyNode<string>;
}

export function CardSection({ cardNumber, cardExpiry, cardCvv }: CardSectionProps) {
  const t = useTranslations();

  return (
    <BranchSection title={t("sections.cardDetails")} shownWith={cardNumber}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="md:col-span-3">
          <TextField field={cardNumber} />
        </div>
        <TextField field={cardExpiry} />
        <TextField field={cardCvv} />
      </div>
    </BranchSection>
  );
}
