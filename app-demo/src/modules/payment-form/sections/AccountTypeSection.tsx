"use client";

import { useTranslations } from "next-intl";

import { Input, Select } from "@/components/ui";
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

  return (
    <Section title={t("sections.accountType")}>
      <div className="space-y-4">
        <Select
          {...getFieldProps("accountType")}
          options={ACCOUNT_TYPE_OPTIONS.map((o) => ({
            ...o,
            label: t(o.label),
          }))}
          onValueChange={(v) => setValue("accountType", v as AccountType)}
        />
        {isCompanyVisible && <Input {...getFieldProps("companyName")} />}
      </div>
    </Section>
  );
}
