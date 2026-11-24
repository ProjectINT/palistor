"use client";

import { useTranslations } from "next-intl";
import type { FieldProxyNode } from "@palistor";

import { SelectField } from "@/components/SelectField";
import { TextField } from "@/components/TextField";
import type { AccountType } from "@/config/appConfig";
import { Section } from "@/modules/shared/Section";
import { ACCOUNT_TYPES } from "../constants";

interface AccountTypeSectionProps {
  accountType: FieldProxyNode<AccountType>;
  companyName: FieldProxyNode<string>;
}

export function AccountTypeSection({ accountType, companyName }: AccountTypeSectionProps) {
  const t = useTranslations();
  const options = ACCOUNT_TYPES.map((value) => ({ value, label: t(`accountTypes.${value}`) }));

  return (
    <Section title={t("sections.accountType")}>
      <div className="space-y-4">
        <SelectField field={accountType} options={options} />
        <TextField field={companyName} />
      </div>
    </Section>
  );
}
