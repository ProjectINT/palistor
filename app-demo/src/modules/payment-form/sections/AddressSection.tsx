"use client";

import { useTranslations } from "next-intl";
import { useForm } from "@palistor";
import type { FieldProxyNode } from "@palistor";

import { SelectField } from "@/components/SelectField";
import { TextField } from "@/components/TextField";
import type { Country } from "@/config/appConfig";
import { Section } from "@/modules/shared/Section";
import { CITIES, COUNTRIES } from "../constants";

interface AddressSectionProps {
  country: FieldProxyNode<Country | "">;
  city: FieldProxyNode<string>;
  shippingCost: FieldProxyNode<number>;
}

export function AddressSection({ country, city, shippingCost }: AddressSectionProps) {
  const t = useTranslations();
  const countries = COUNTRIES.map((value) => ({ value, label: t(`countries.${value}`) }));

  return (
    <Section title={t("sections.address")}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SelectField field={country} options={countries} />
        <CityField city={city} country={country} />
        <TextField field={shippingCost} />
      </div>
    </Section>
  );
}

/** The city select: its options follow the country. */
function CityField({ city, country }: { city: FieldProxyNode<string>; country: FieldProxyNode<Country | ""> }) {
  const t = useTranslations();
  const { value } = useForm(country);
  const cities = value ? CITIES[value].map((c) => ({ value: c, label: t(`cities.${c}`) })) : [];

  return <SelectField field={city} options={cities} />;
}
