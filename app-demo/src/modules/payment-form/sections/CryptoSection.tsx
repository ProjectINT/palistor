"use client";

import { useTranslations } from "next-intl";
import { Input, Select, SelectItem } from "@heroui/react";

import { Section } from "@/modules/shared/Section";
import { CRYPTO_NETWORK_OPTIONS } from "../constants";
import { usePaymentForm, type CryptoNetwork } from "@/config/paymentForm";

interface CryptoSectionProps {
  formId: string;
}

export function CryptoSection({ formId }: CryptoSectionProps) {
  const t = useTranslations();
  const { getFieldProps, setValue } = usePaymentForm(formId);
  const cryptoWalletProps = getFieldProps("cryptoWallet");
  const cryptoNetworkProps = getFieldProps("cryptoNetwork");
  const isVisible = cryptoWalletProps.isVisible;

  if (!isVisible) return null;

  return (
    <Section title={t("sections.crypto")}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input {...cryptoWalletProps} />
        <Select
          {...cryptoNetworkProps}
          selectedKeys={cryptoNetworkProps.value ? [cryptoNetworkProps.value] : []}
          onSelectionChange={(keys) => {
            const value = Array.from(keys)[0] as CryptoNetwork;
            setValue("cryptoNetwork", value);
          }}
        >
          {CRYPTO_NETWORK_OPTIONS.map((option) => (
            <SelectItem key={option.value}>
              {t(option.label)}
            </SelectItem>
          ))}
        </Select>
      </div>
    </Section>
  );
}
