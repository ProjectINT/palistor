import type { TranslateFn } from "@palistor";
import type { PaymentFormValues, PaymentType } from "./types";

/** The payment method, which every card / bank / crypto field depends on, and the fields all methods share. */
export const payment = {
  paymentType: {
    value: "card" as PaymentType,
    label: (t: TranslateFn) => t("form.paymentType"),
  },

  amount: {
    value: 0,
    label: (t: TranslateFn) => t("form.amount"),
    placeholder: (t: TranslateFn) => t("form.amountPlaceholder"),
    isRequired: true,
    // An input yields a string: store the number the field is typed as.
    formatter: (raw: unknown) => Number(raw) || 0,
    validate: (value: number, _values: PaymentFormValues, t: TranslateFn) =>
      value <= 0 ? t("validation.amountMin", { min: 1 }) : undefined,
  },

  comment: {
    value: "",
    label: (t: TranslateFn) => t("form.comment"),
    placeholder: (t: TranslateFn) => t("form.commentPlaceholder"),
  },
};
