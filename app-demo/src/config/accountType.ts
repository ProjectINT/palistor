import type { PaymentFormValues } from "./types";
import type { FormConfig } from "@palistor";

export const accountType: Pick<FormConfig<PaymentFormValues>, 'accountType' | 'companyName'> = {
  accountType: {
    types: {
      dataType: "String" as const,
      type: "AccountType"
    },
    value: "personal" as const,
    label: (t) => t("form.accountType"),
    dependencies: [] as const,
  },

  companyName: {
    types: {
      dataType: "String" as const,
      type: "string"
    },
    value: "",
    label: (t) => t("form.companyName"),
    placeholder: (t) => t("form.companyNamePlaceholder"),
    isVisible: (values: PaymentFormValues) => values.accountType === "business",
    isRequired: (values: PaymentFormValues) => values.accountType === "business",
    dependencies: ["accountType"] as const,
  },
}