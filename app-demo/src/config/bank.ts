import type { TranslateFn } from "@palistor";
import type { PaymentFormValues } from "./types";

const byBank = (values: PaymentFormValues) => values.paymentType === "bank";

/** Bank transfer fields: required and validated only when they are shown. */
export const bank = {
  bankAccount: {
    value: "",
    label: (t: TranslateFn) => t("form.bankAccount"),
    placeholder: (t: TranslateFn) => t("form.bankAccountPlaceholder"),
    isVisible: byBank,
    isRequired: byBank,
    formatter: (raw: unknown) => String(raw).replace(/\D/g, "").slice(0, 20),
    validate: (value: string, values: PaymentFormValues, t: TranslateFn) =>
      byBank(values) && value.length < 20 ? t("validation.bankAccountInvalid") : undefined,
  },

  bankBik: {
    value: "",
    label: (t: TranslateFn) => t("form.bankBik"),
    placeholder: (t: TranslateFn) => t("form.bankBikPlaceholder"),
    isVisible: byBank,
    isRequired: byBank,
    formatter: (raw: unknown) => String(raw).replace(/\D/g, "").slice(0, 9),
    validate: (value: string, values: PaymentFormValues, t: TranslateFn) =>
      byBank(values) && value.length < 9 ? t("validation.bikInvalid") : undefined,
  },
};
