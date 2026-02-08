import type { PaymentFormValues } from "./types";
import type { TranslateFn, FormConfig } from "@palistor/core/types";

export const crypto: Pick<FormConfig<PaymentFormValues>, 'cryptoWallet' | 'cryptoNetwork'> = {
  cryptoWallet: {
    types: {
      dataType: "String" as const,
      type: "string"
    },
    value: "",
    label: (t: TranslateFn) => t("form.cryptoWallet"),
    placeholder: (t: TranslateFn) => t("form.cryptoWalletPlaceholder"),
    isVisible: (values: PaymentFormValues) => values.paymentType === "crypto",
    isRequired: (values: PaymentFormValues) => values.paymentType === "crypto",
    dependencies: ["paymentType"],
    validate: (value: string, values: PaymentFormValues) => {
      if (values.paymentType !== "crypto") return;
      if (value.length < 20) {
        return "validation.cryptoWalletInvalid";
      }
    },
  },

  cryptoNetwork: {
    types: {
      dataType: "String" as const,
      type: "CryptoNetwork"
    },
    value: "ethereum",
    label: (t: TranslateFn) => t("form.cryptoNetwork"),
    isVisible: (values: PaymentFormValues) => values.paymentType === "crypto",
    isRequired: (values: PaymentFormValues) => values.paymentType === "crypto",
    dependencies: ["paymentType"],
  },
};