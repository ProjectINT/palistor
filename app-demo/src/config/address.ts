import type { TranslateFn } from "@palistor";
import type { Country, PaymentFormValues } from "./types";

const SHIPPING_COST: Record<Country, number> = { ru: 300, us: 25, de: 15 };

/** A cascade: the country resets the city, both decide the computed shipping cost. */
export const address = {
  country: {
    value: "" as Country | "",
    label: (t: TranslateFn) => t("form.country"),
    placeholder: (t: TranslateFn) => t("form.countryPlaceholder"),
    // The city belongs to the previous country: clear it within the same write.
    setter: () => ({ city: "" }),
  },

  city: {
    value: "",
    label: (t: TranslateFn) => t("form.city"),
    placeholder: (t: TranslateFn) => t("form.cityPlaceholder"),
    isVisible: (values: PaymentFormValues) => values.country !== "",
  },

  shippingCost: {
    value: (values: PaymentFormValues) => (values.country && values.city ? SHIPPING_COST[values.country] : 0),
    label: (t: TranslateFn) => t("form.shippingCost"),
    isVisible: (values: PaymentFormValues) => values.country !== "" && values.city !== "",
    isReadOnly: true,
  },
};
