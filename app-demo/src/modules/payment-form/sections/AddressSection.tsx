"use client";

import { useTranslations } from "next-intl";
import { Input, Select, SelectItem } from "@heroui/react";

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
  const isCityVisible = cityProps.isVisible;
  const isShippingVisible = shippingProps.isVisible;

  const cityOptions = country ? (CITIES_BY_COUNTRY[country] ?? []) : [];

  return (
    <Section title={t("sections.address")}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Select
          {...countryProps}
          selectedKeys={countryProps.value ? [countryProps.value] : []}
          onSelectionChange={(keys) => {
            const value = Array.from(keys)[0] as "" | Country;
            setValue("country", value);
          }}
        >
          {COUNTRY_OPTIONS.map((option) => (
            <SelectItem key={option.value}>
              {t(option.label)}
            </SelectItem>
          ))}
        </Select>
        {isCityVisible && (
          <Select
            {...cityProps}
            selectedKeys={cityProps.value ? [cityProps.value] : []}
            onSelectionChange={(keys) => {
              const value = Array.from(keys)[0] as string;
              setValue("city", value);
            }}
          >
            {cityOptions.map((option) => (
              <SelectItem key={option.value}>
                {t(option.label)}
              </SelectItem>
            ))}
          </Select>
        )}
        {isShippingVisible && (
          <Input
            {...(({ value, isVisible, error, ...rest }) => rest)(shippingProps)}
            value={shippingProps.value?.toString() ?? ""}
          />
        )}
      </div>
    </Section>
  );
}
