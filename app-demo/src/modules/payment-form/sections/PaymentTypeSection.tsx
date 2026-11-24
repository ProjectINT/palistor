"use client";

import { useTranslations } from "next-intl";
import type { FieldProxyNode } from "@palistor";

import { SelectField } from "@/components/SelectField";
import type { PaymentType } from "@/config/appConfig";
import { Section } from "@/modules/shared/Section";
import { PAYMENT_TYPES } from "../constants";

export function PaymentTypeSection({ paymentType }: { paymentType: FieldProxyNode<PaymentType> }) {
  const t = useTranslations();
  const options = PAYMENT_TYPES.map((value) => ({ value, label: t(`paymentTypes.${value}`) }));

  return (
    <Section title={t("sections.paymentType")}>
      <SelectField field={paymentType} options={options} />
    </Section>
  );
}
