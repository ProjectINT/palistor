import type { PaymentFormValues } from "./types";
import type { FormConfig, TranslateFn } from "@palistor";

export const bank: Pick<FormConfig<PaymentFormValues>, 'bankAccount' | 'bankBik'> = {
  bankAccount: {
    types: {
      dataType: "String" as const,
      type: "string"
    },
    value: "",
    label: (t: TranslateFn) => t("form.bankAccount"),
    placeholder: (t: TranslateFn) => t("form.bankAccountPlaceholder"),
    isVisible: (values: PaymentFormValues) => values.paymentType === "bank",
    isRequired: (values: PaymentFormValues) => values.paymentType === "bank",
    dependencies: ["paymentType"],
    formatter: (value) => String(value).replace(/\D/g, "").slice(0, 20),
    validate: (value: string, values: PaymentFormValues, t) => {
      if (values.paymentType !== "bank") return;
      if (value.length < 20) {
        return t("validation.bankAccountInvalid");
      }
    },
  },
  bankBik: {
    types: {
      dataType: "String" as const,
      type: "string"
    },
    value: "",
    label: (t: TranslateFn) => t("form.bankBik"),
    placeholder: (t: TranslateFn) => t("form.bankBikPlaceholder"),
    isVisible: (values: PaymentFormValues) => values.paymentType === "bank",
    isRequired: (values: PaymentFormValues) => values.paymentType === "bank",
    dependencies: ["paymentType"],
    formatter: (value) => String(value).replace(/\D/g, "").slice(0, 9),
    validate: (value: string, values: PaymentFormValues, t) => {
      if (values.paymentType !== "bank") return;
      if (value.length < 9) {
        return t("validation.bikInvalid");
      }
    },
  },
};