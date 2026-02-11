"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/Input";
import { Select, type SelectOption } from "@/components/Select";

import { Section } from "@/modules/shared/Section";
import { ACCOUNT_TYPE_OPTIONS } from "../constants";
import { usePaymentForm, type AccountType } from "@/config/paymentForm";

interface AccountTypeSectionProps {
  formId: string;
}

export function AccountTypeSection({ formId }: AccountTypeSectionProps) {
  const t = useTranslations();
  const { getFieldProps, setValue } = usePaymentForm(formId);

  const accountTypeProps = getFieldProps("accountType");
  const companyNameProps = getFieldProps("companyName");

  const options: SelectOption[] = ACCOUNT_TYPE_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
  }));
  
  return (
    <Section title={t("sections.accountType")}>
      <div className="space-y-4">
        <Select
          {...accountTypeProps}
          options={options}
          renderLabel={(option) => t(option.label)}
          selectedKeys={accountTypeProps.value ? [accountTypeProps.value] : []}
          onSelectionChange={(keys) => {
            const value = Array.from(keys)[0] as AccountType;
            setValue("accountType", value);
          }}
        />
        <Input {...companyNameProps} />
      </div>
    </Section>
  );
}
