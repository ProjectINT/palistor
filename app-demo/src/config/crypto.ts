import type { TranslateFn } from "@palistor";
import type { CryptoNetwork, PaymentFormValues } from "./types";

const byCrypto = (values: PaymentFormValues) => values.paymentType === "crypto";

/** Cryptocurrency fields: required and validated only when they are shown. */
export const crypto = {
  cryptoWallet: {
    value: "",
    label: (t: TranslateFn) => t("form.cryptoWallet"),
    placeholder: (t: TranslateFn) => t("form.cryptoWalletPlaceholder"),
    isVisible: byCrypto,
    isRequired: byCrypto,
    validate: (value: string, values: PaymentFormValues, t: TranslateFn) =>
      byCrypto(values) && value.length < 20 ? t("validation.cryptoWalletInvalid") : undefined,
  },

  cryptoNetwork: {
    value: "ethereum" as CryptoNetwork,
    label: (t: TranslateFn) => t("form.cryptoNetwork"),
    isVisible: byCrypto,
    isRequired: byCrypto,
  },
};
