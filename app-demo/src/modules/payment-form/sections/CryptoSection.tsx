"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/Input";
import { Select, type SelectOption } from "@/components/Select";

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

  const options: SelectOption[] = CRYPTO_NETWORK_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
  }));

  return (
    <Section title={t("sections.crypto")}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input {...cryptoWalletProps} />
        <Select
          {...cryptoNetworkProps}
          options={options}
          renderLabel={(option) => t(option.label)}
          selectedKeys={cryptoNetworkProps.value ? [cryptoNetworkProps.value] : []}
          onSelectionChange={(keys) => {
            const value = Array.from(keys)[0] as CryptoNetwork;
            setValue("cryptoNetwork", value);
          }}
        />
      </div>
    </Section>
  );
}
