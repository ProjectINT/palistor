"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/Input";
import { Select, type SelectOption } from "@/components/Select";

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
  const cityProps = getFieldProps("city");
  const shippingProps = getFieldProps("shippingCost");
  
  const country = countryProps.value as Country | undefined;

  const countryOptions: SelectOption[] = COUNTRY_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
  }));

  const cityOptions: SelectOption[] = country ? (CITIES_BY_COUNTRY[country] ?? []).map((option) => ({
    value: option.value,
    label: option.label,
  })) : [];

  return (
    <Section title={t("sections.address")}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Select
          {...countryProps}
          options={countryOptions}
          renderLabel={(option) => t(option.label)}
          selectedKeys={countryProps.value ? [countryProps.value] : []}
          onSelectionChange={(keys) => {
            const value = Array.from(keys)[0] as "" | Country;
            setValue("country", value);
          }}
        />
        <Select
          {...cityProps}
          options={cityOptions}
          renderLabel={(option) => t(option.label)}
          selectedKeys={cityProps.value ? [cityProps.value] : []}
          onSelectionChange={(keys) => {
            const value = Array.from(keys)[0] as string;
            setValue("city", value);
          }}
        />
        <Input {...shippingProps} />
      </div>
    </Section>
  );
}
