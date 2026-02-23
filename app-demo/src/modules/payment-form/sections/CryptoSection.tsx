"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/Input";
import { Select, type SelectOption } from "@/components/Select";

import { Section } from "@/modules/shared/Section";
import { CRYPTO_NETWORK_OPTIONS } from "../constants";
import { usePaymentForm, fieldProps, type CryptoNetwork } from "@/config/paymentForm";

export function CryptoSection() {
  const t = useTranslations();
  const form = usePaymentForm();

  const options: SelectOption[] = CRYPTO_NETWORK_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
  }));

  return (
    <Section title={t("sections.crypto")}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input {...fieldProps(form.cryptoWallet)} />
        <Select
          {...fieldProps(form.cryptoNetwork)}
          options={options}
          renderLabel={(option) => t(option.label)}
          selectedKeys={form.cryptoNetwork.value ? [form.cryptoNetwork.value] : []}
          onSelectionChange={(keys) => {
            const value = Array.from(keys)[0] as CryptoNetwork;
            form.cryptoNetwork.value = value;
          }}
        />
      </div>
    </Section>
  );
}
