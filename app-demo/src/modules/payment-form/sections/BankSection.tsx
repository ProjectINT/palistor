"use client";

import { useTranslations } from "next-intl";
import type { FieldProxyNode } from "@palistor";

import { TextField } from "@/components/TextField";
import { BranchSection } from "./BranchSection";

interface BankSectionProps {
  bankAccount: FieldProxyNode<string>;
  bankBik: FieldProxyNode<string>;
}

export function BankSection({ bankAccount, bankBik }: BankSectionProps) {
  const t = useTranslations();

  return (
    <BranchSection title={t("sections.bankTransfer")} shownWith={bankAccount}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <TextField field={bankAccount} />
        <TextField field={bankBik} />
      </div>
    </BranchSection>
  );
}
