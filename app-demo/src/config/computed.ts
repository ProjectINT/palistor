import type { TranslateFn } from "@palistor";
import type { PaymentFormValues } from "./types";

// An input yields a string: store the number the field is typed as.
const toNumber = (raw: unknown) => Number(raw) || 0;

/** A computed field: `total` follows `price` and `quantity`. */
export const computed = {
  price: {
    value: 100,
    label: (t: TranslateFn) => t("form.price"),
    placeholder: (t: TranslateFn) => t("form.pricePlaceholder"),
    formatter: toNumber,
  },

  quantity: {
    value: 1,
    label: (t: TranslateFn) => t("form.quantity"),
    formatter: toNumber,
  },

  total: {
    value: (values: PaymentFormValues) => values.price * values.quantity,
    label: (t: TranslateFn) => t("form.total"),
    isReadOnly: true,
  },
};
