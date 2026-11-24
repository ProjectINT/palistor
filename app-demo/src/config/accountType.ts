import type { TranslateFn } from "@palistor";
import type { AccountType, PaymentFormValues } from "./types";

const isBusiness = (values: PaymentFormValues) => values.accountType === "business";

/** A field that is required only while another field has a certain value. */
export const accountType = {
  accountType: {
    value: "personal" as AccountType,
    label: (t: TranslateFn) => t("form.accountType"),
  },

  companyName: {
    value: "",
    label: (t: TranslateFn) => t("form.companyName"),
    placeholder: (t: TranslateFn) => t("form.companyNamePlaceholder"),
    isVisible: isBusiness,
    isRequired: isBusiness,
    validate: (value: string, values: PaymentFormValues, t: TranslateFn) =>
      isBusiness(values) && !value.trim() ? t("validation.companyRequired") : undefined,
  },
};
