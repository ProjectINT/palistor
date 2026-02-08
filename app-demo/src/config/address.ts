import type { Country, PaymentFormValues } from "./types";
import type { TranslateFn, FormConfig } from "@palistor/core/types";

export const address: Pick<FormConfig<PaymentFormValues>, 'country' | 'city' | 'shippingCost'> = {
  country: {
    types: {
      dataType: "String" as const,
      type: "Country"
    },
    value: "",
    label: (t: TranslateFn) => t("form.country"),
    placeholder: (t: TranslateFn) => t("form.countryPlaceholder"),
    dependencies: [],
    // Setter — при изменении страны сбрасываем город
    setter: (value: string, values: PaymentFormValues, setValues: any) => {
      setValues({ country: value, city: "" }, "country");
    },
  },

  city: {
    types: {
      dataType: "String" as const,
      type: "string"
    },
    value: "",
    label: (t: TranslateFn) => t("form.city"),
    placeholder: (t: TranslateFn) => t("form.cityPlaceholder"),
    isVisible: (values: PaymentFormValues) => values.country !== "",
    isDisabled: (values: PaymentFormValues) => values.country === "",
    dependencies: ["country"],
  },

  shippingCost: {
    types: {
      dataType: "Number" as const,
      type: "number"
    },
    // Computed value — стоимость доставки зависит от страны
    value: (values: PaymentFormValues) => {
      if (!values.country || !values.city) return 0;
      const costs: Record<Country, number> = {
        ru: 300,
        us: 25,
        de: 15,
      };
      return costs[values.country as Country] ?? 0;
    },
    label: (t: TranslateFn) => t("form.shippingCost"),
    isVisible: (values: PaymentFormValues) => values.country !== "" && values.city !== "",
    isReadOnly: true, // Вычисляемое поле
    dependencies: ["country", "city"],
  },
};