"use client";

import { useTranslations } from "next-intl";
import type { FieldProxyNode } from "@palistor";

import { SelectField } from "@/components/SelectField";
import { TextField } from "@/components/TextField";
import type { CryptoNetwork } from "@/config/appConfig";
import { CRYPTO_NETWORKS } from "../constants";
import { BranchSection } from "./BranchSection";

interface CryptoSectionProps {
  cryptoWallet: FieldProxyNode<string>;
  cryptoNetwork: FieldProxyNode<CryptoNetwork>;
}

export function CryptoSection({ cryptoWallet, cryptoNetwork }: CryptoSectionProps) {
  const t = useTranslations();
  const options = CRYPTO_NETWORKS.map((value) => ({ value, label: t(`networks.${value}`) }));

  return (
    <BranchSection title={t("sections.crypto")} shownWith={cryptoWallet}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <TextField field={cryptoWallet} />
        <SelectField field={cryptoNetwork} options={options} />
      </div>
    </BranchSection>
  );
}
