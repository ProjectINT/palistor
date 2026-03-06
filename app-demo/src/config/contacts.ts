import type { FormConfig, TranslateFn } from "@palistor";
import type { PaymentFormValues } from "./types";

export const contacts: Pick<FormConfig<PaymentFormValues>, 'email' | 'phone' | 'name'> = {
  email: {
    types: {
      dataType: "String" as const,
      type: "string"
    },
    value: "",
    label: (t: TranslateFn) => t("form.email"),
    placeholder: (t: TranslateFn) => t("form.emailPlaceholder"),
    isRequired: true,
    dependencies: [],
    validate: (value: string, _values: PaymentFormValues, t: TranslateFn) => {
      if (!value.includes("@")) {
        return t("validation.email");
      }
    },
  },

  phone: {
    types: {
      dataType: "String" as const,
      type: "string"
    },
    value: "",
    label: (t: TranslateFn) => t("form.phone"),
    placeholder: (t: TranslateFn) => t("form.phonePlaceholder"),
    dependencies: [],
    formatter: (value) => {
      // Простой форматтер для телефона
      const digits = String(value).replace(/\D/g, "").slice(0, 11);
      if (digits.length === 0) return "";
      if (digits.length <= 1) return `+${digits}`;
      if (digits.length <= 4) return `+${digits.slice(0, 1)} (${digits.slice(1)}`;
      if (digits.length <= 7) return `+${digits.slice(0, 1)} (${digits.slice(1, 4)}) ${digits.slice(4)}`;
      if (digits.length <= 9) return `+${digits.slice(0, 1)} (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
      return `+${digits.slice(0, 1)} (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`;
    },
  },

  name: {
    types: {
      dataType: "String" as const,
      type: "string"
    },
    value: "",
    label: (t: TranslateFn) => t("form.name"),
    placeholder: (t: TranslateFn) => t("form.namePlaceholder"),
    isRequired: true,
    dependencies: [],
  },
};