"use client";

import { useTranslations } from "next-intl";

import { Input, Select } from "@/components/ui";
import { Section } from "@/modules/shared/Section";
import { COUNTRY_OPTIONS, CITIES_BY_COUNTRY } from "../constants";
import { usePaymentForm, type Country } from "@/config/paymentForm";

interface AddressSectionProps {
  formId: string;
}

export function AddressSection({ formId }: AddressSectionProps) {
  const t = useTranslations();
  const { getFieldProps, setValue } = usePaymentForm(formId);

  const countryProps = getFieldProps("country");
  const country = countryProps.value as Country | undefined;
  const isCityVisible = getFieldProps("city").isVisible;
  const isShippingVisible = getFieldProps("shippingCost").isVisible;

  const cityOptions = country ? (CITIES_BY_COUNTRY[country] ?? []) : [];

  return (
    <Section title={t("sections.address")}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Select
          {...getFieldProps("country")}
          onValueChange={(v) => setValue("country", v as "" | Country)}
          options={COUNTRY_OPTIONS.map((o) => ({
            ...o,
            label: t(o.label),
          }))}
        />
        {isCityVisible && (
          <Select
            {...getFieldProps("city")}
            options={cityOptions.map((o) => ({
              ...o,
              label: t(o.label),
            }))}
          />
        )}
        {isShippingVisible && <Input {...getFieldProps("shippingCost")} />}
      </div>
    </Section>
  );
}
