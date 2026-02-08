import type { PaymentFormValues } from "./types";
import type { TranslateFn, FormConfig } from "@palistor/core/types";

export const card: Pick<FormConfig<PaymentFormValues>, 'cardNumber' | 'cardExpiry' | 'cardCvv'> = {
  cardNumber: {
    types: {
      dataType: "String" as const,
      type: "string"
    },
    value: "",
    label: (t: TranslateFn) => t("form.cardNumber"),
    placeholder: (t: TranslateFn) => t("form.cardNumberPlaceholder"),
    isVisible: (values: PaymentFormValues) => values.paymentType === "card",
    isRequired: (values: PaymentFormValues) => values.paymentType === "card",
    dependencies: ["paymentType"] as const,
    // Форматтер — добавляем пробелы каждые 4 цифры
    formatter: (value: string) => {
      const digits = value.replace(/\D/g, "").slice(0, 16);
      return digits.replace(/(.{4})/g, "$1 ").trim();
    },
    validate: (value: string, values: PaymentFormValues) => {
      if (values.paymentType !== "card") return;
      const digits = value.replace(/\D/g, "");
      if (digits.length < 16) {
        return "validation.cardNumberInvalid";
      }
    },
  },
  cardExpiry: {
    types: {
      dataType: "String" as const,
      type: "string"
    },
    value: "",
    label: (t: TranslateFn) => t("form.cardExpiry"),
    placeholder: (t: TranslateFn) => t("form.cardExpiryPlaceholder"),
    isVisible: (values: PaymentFormValues) => values.paymentType === "card",
    isRequired: (values: PaymentFormValues) => values.paymentType === "card",
    dependencies: ["paymentType"] as const,
    formatter: (value: string) => {
      const digits = value.replace(/\D/g, "").slice(0, 4);
      if (digits.length >= 2) {
        return digits.slice(0, 2) + "/" + digits.slice(2);
      }
      return digits;
    },
    validate: (value: string, values: PaymentFormValues) => {
      if (values.paymentType !== "card") return;
      const digits = value.replace(/\D/g, "");
      if (digits.length < 4) {
        return "validation.cardExpiryInvalid";
      }
    },
  },

  cardCvv: {
    types: {
      dataType: "String" as const,
      type: "string"
    },
    value: "",
    label: (t: TranslateFn) => t("form.cardCvv"),
    placeholder: (t: TranslateFn) => t("form.cardCvvPlaceholder"),
    isVisible: (values: PaymentFormValues) => values.paymentType === "card",
    isRequired: (values: PaymentFormValues) => values.paymentType === "card",
    dependencies: ["paymentType"] as const,
    formatter: (value: string) => value.replace(/\D/g, "").slice(0, 3),
    validate: (value: string, values: PaymentFormValues) => {
      if (values.paymentType !== "card") return;
      if (value.length < 3) {
        return "validation.cardCvvInvalid";
      }
    },
  },
};
