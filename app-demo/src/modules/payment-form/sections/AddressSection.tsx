"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/Input";
import { Select, type SelectOption } from "@/components/Select";

import { Section } from "@/modules/shared/Section";
import { COUNTRY_OPTIONS, CITIES_BY_COUNTRY } from "../constants";
import { usePaymentForm, type Country } from "@/config/paymentForm";

export function AddressSection() {
  const t = useTranslations();
  const form = usePaymentForm();

  const country = form.country.value as Country | undefined;

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
          {...form.country}
          options={countryOptions}
          renderLabel={(option) => t(option.label)}
          selectedKeys={form.country.value ? [form.country.value] : []}
          onSelectionChange={(keys) => {
            const value = Array.from(keys)[0] as "" | Country;
            form.country.value = value;
          }}
        />
        <Select
          {...form.city}
          options={cityOptions}
          renderLabel={(option) => t(option.label)}
          selectedKeys={form.city.value ? [form.city.value] : []}
          onSelectionChange={(keys) => {
            const value = Array.from(keys)[0] as string;
            form.city.value = value;
          }}
        />
        <Input {...form.shippingCost} />
      </div>
    </Section>
  );
}
