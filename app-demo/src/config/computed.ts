import type { PaymentFormValues } from "./types";
import type { TranslateFn, FormConfig } from "@palistor/core/types";

export const computed: Pick<FormConfig<PaymentFormValues>, 'price' | 'quantity' | 'total'> = {
  price: {
    types: {
      dataType: "Number" as const,
      type: "number"
    },
    value: 100,
    label: (t: TranslateFn) => t("form.price"),
    placeholder: (t: TranslateFn) => t("form.pricePlaceholder"),
  },
  quantity: {
    types: {
      dataType: "Number" as const,
      type: "number"
    },
    value: 1,
    label: (t: TranslateFn) => t("form.quantity"),
  },
  total: {
    types: {
      dataType: "Number" as const,
      type: "number"
    },
    // Computed value — автоматически вычисляется
    value: (values: PaymentFormValues) => values.price * values.quantity,
    label: (t: TranslateFn) => t("form.total"),
    isReadOnly: true,
  },
};