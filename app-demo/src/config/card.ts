import type { TranslateFn } from "@palistor";
import type { PaymentFormValues } from "./types";

const byCard = (values: PaymentFormValues) => values.paymentType === "card";

const digits = (raw: unknown, max: number) => String(raw).replace(/\D/g, "").slice(0, max);

/**
 * Card fields. Hidden fields are still validated on submit, so each one
 * repeats the visibility predicate in `isRequired` and in `validate`.
 */
export const card = {
  cardNumber: {
    value: "",
    label: (t: TranslateFn) => t("form.cardNumber"),
    placeholder: (t: TranslateFn) => t("form.cardNumberPlaceholder"),
    isVisible: byCard,
    isRequired: byCard,
    // "4111111111111111" → "4111 1111 1111 1111"
    formatter: (raw: unknown) => digits(raw, 16).replace(/(.{4})/g, "$1 ").trim(),
    validate: (value: string, values: PaymentFormValues, t: TranslateFn) =>
      byCard(values) && digits(value, 16).length < 16 ? t("validation.cardNumberInvalid") : undefined,
  },

  cardExpiry: {
    value: "",
    label: (t: TranslateFn) => t("form.cardExpiry"),
    placeholder: (t: TranslateFn) => t("form.cardExpiryPlaceholder"),
    isVisible: byCard,
    isRequired: byCard,
    // "1229" → "12/29"
    formatter: (raw: unknown) => digits(raw, 4).replace(/^(\d{2})(?=\d)/, "$1/"),
    validate: (value: string, values: PaymentFormValues, t: TranslateFn) =>
      byCard(values) && digits(value, 4).length < 4 ? t("validation.cardExpiryInvalid") : undefined,
  },

  cardCvv: {
    value: "",
    label: (t: TranslateFn) => t("form.cardCvv"),
    placeholder: (t: TranslateFn) => t("form.cardCvvPlaceholder"),
    isVisible: byCard,
    isRequired: byCard,
    formatter: (raw: unknown) => digits(raw, 3),
    validate: (value: string, values: PaymentFormValues, t: TranslateFn) =>
      byCard(values) && value.length < 3 ? t("validation.cardCvvInvalid") : undefined,
  },
};
