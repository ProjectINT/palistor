import type { PaymentFormValues } from "./types";
import type { FormConfig } from "@palistor";

export const computed: Pick<FormConfig<PaymentFormValues>, 'price' | 'quantity' | 'total'> = {
  price: {
    types: {
      dataType: "Number" as const,
      type: "number"
    },
    value: 100,
    label: (t) => t("form.price"),
    placeholder: (t) => t("form.pricePlaceholder"),
  },
  quantity: {
    types: {
      dataType: "Number" as const,
      type: "number"
    },
    value: 1,
    label: (t) => t("form.quantity"),
  },
  total: {
    types: {
      dataType: "Number" as const,
      type: "number"
    },
    // Computed value — автоматически вычисляется
    value: (values: PaymentFormValues) => values.price * values.quantity,
    label: (t) => t("form.total"),
    isReadOnly: true,
  },
};