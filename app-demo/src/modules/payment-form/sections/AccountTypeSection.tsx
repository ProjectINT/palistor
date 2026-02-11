"use client";

import { useTranslations } from "next-intl";
import { Input, Select, SelectItem } from "@heroui/react";

import { Section } from "@/modules/shared/Section";
import { ACCOUNT_TYPE_OPTIONS } from "../constants";
import { usePaymentForm, type AccountType } from "@/config/paymentForm";

interface AccountTypeSectionProps {
  formId: string;
}

export function AccountTypeSection({ formId }: AccountTypeSectionProps) {
  const t = useTranslations();
  const { getFieldProps, setValue } = usePaymentForm(formId);
  const isCompanyVisible = getFieldProps("companyName").isVisible;

  const accountTypeProps = getFieldProps("accountType");
  const companyNameProps = getFieldProps("companyName");
  
  return (
    <Section title={t("sections.accountType")}>
      <div className="space-y-4">
        <Select
          {...accountTypeProps}
          selectedKeys={accountTypeProps.value ? [accountTypeProps.value] : []}
          onSelectionChange={(keys) => {
            const value = Array.from(keys)[0] as AccountType;
            setValue("accountType", value);
          }}
        >
          {ACCOUNT_TYPE_OPTIONS.map((option) => (
            <SelectItem key={option.value}>
              {t(option.label)}
            </SelectItem>
          ))}
        </Select>
        {isCompanyVisible && (
          <Input {...companyNameProps} />
        )}
      </div>
    </Section>
  );
}
