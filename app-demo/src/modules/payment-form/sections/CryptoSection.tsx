"use client";

import { useTranslations } from "next-intl";

import { Input, Select } from "@/components/ui";
import { Section } from "@/modules/shared/Section";
import { CRYPTO_NETWORK_OPTIONS } from "../constants";
import { usePaymentForm, type CryptoNetwork } from "@/config/paymentForm";

interface CryptoSectionProps {
  formId: string;
}

export function CryptoSection({ formId }: CryptoSectionProps) {
  const t = useTranslations();
  const { getFieldProps, setValue } = usePaymentForm(formId);
  const isVisible = getFieldProps("cryptoWallet").isVisible;

  if (!isVisible) return null;

  return (
    <Section title={t("sections.crypto")}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input {...getFieldProps("cryptoWallet")} />
        <Select
          {...getFieldProps("cryptoNetwork")}
          options={CRYPTO_NETWORK_OPTIONS.map((o) => ({
            ...o,
            label: t(o.label),
          }))}
          onValueChange={(v) => setValue("cryptoNetwork", v as CryptoNetwork)}
        />
      </div>
    </Section>
  );
}
