"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/Input";
import { Select, type SelectOption } from "@/components/Select";

import { Section } from "@/modules/shared/Section";
import { ACCOUNT_TYPE_OPTIONS } from "../constants";
import { usePaymentForm, type AccountType } from "@/config/paymentForm";

export function AccountTypeSection() {
  const t = useTranslations();
  const form = usePaymentForm();

  const options: SelectOption[] = ACCOUNT_TYPE_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
  }));

  return (
    <Section title={t("sections.accountType")}>
      <div className="space-y-4">
        <Select
          options={options}
          renderLabel={(option: SelectOption) => t(option.label)}
          selectedKeys={form.accountType.value ? [form.accountType.value] : []}
          onSelectionChange={(keys: Set<string>) => {
            const value = Array.from(keys)[0] as AccountType;
            form.accountType.value = value;
          }}
          {...form.accountType}
        />
        <Input {...form.companyName} />
      </div>
    </Section>
  );
}
