import type { PaymentFormValues } from "./types";
import type { TranslateFn, FormConfig } from "@palistor/core/types";

export const accountType: Pick<FormConfig<PaymentFormValues>, 'accountType' | 'companyName'> = {
  accountType: {
    types: {
      dataType: "String" as const,
      type: "AccountType"
    },
    value: "personal" as const,
    label: (t: TranslateFn) => t("form.accountType"),
    dependencies: [] as const,
  },

  companyName: {
    types: {
      dataType: "String" as const,
      type: "string"
    },
    value: "",
    label: (t: TranslateFn) => t("form.companyName"),
    placeholder: (t: TranslateFn) => t("form.companyNamePlaceholder"),
    isVisible: (values: PaymentFormValues) => values.accountType === "business",
    isRequired: (values: PaymentFormValues) =>
      values.accountType === "business" ? "validation.companyRequired" : false,
    dependencies: ["accountType"] as const,
  },
}