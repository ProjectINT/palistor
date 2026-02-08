import type { PaymentType, PaymentFormValues } from "./types";
import type { TranslateFn, FormConfig } from "@palistor/core/types";

export const payment: Pick<FormConfig<PaymentFormValues>, 'paymentType' | 'amount'> = {
  paymentType: {
    types: {
      dataType: "String" as const,
      type: "PaymentType"
    },
    value: "card" as PaymentType,
    label: (t: TranslateFn) => t("form.paymentType"),
    // Пересчитывается только при изменении себя
    dependencies: [],
  },
  // --------------------------------------------------------------------------
  // Сумма — общее поле
  // --------------------------------------------------------------------------
  
  amount: {
    types: {
      dataType: "Number" as const,
      type: "number"
    },
    value: 0,
    label: (t: TranslateFn) => t("form.amount"),
    placeholder: (t: TranslateFn) => t("form.amountPlaceholder"),
    isRequired: true,
    dependencies: [],
    validate: (value: number) => {
      if (value <= 0) {
        return "validation.amountMin";
      }
    },
  },
};