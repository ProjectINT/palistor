import type { FormConfig } from "@palistor";
import type { PaymentFormValues } from "./types";

export const contacts: Pick<FormConfig<PaymentFormValues>, 'email' | 'phone' | 'name'> = {
  email: {
    types: {
      dataType: "String" as const,
      type: "string"
    },
    value: "",
    label: (t) => t("form.email"),
    placeholder: (t) => t("form.emailPlaceholder"),
    isRequired: true,
    dependencies: [],
    validate: (value: string) => {
      if (!value.includes("@")) {
        return "validation.email";
      }
    },
  },

  phone: {
    types: {
      dataType: "String" as const,
      type: "string"
    },
    value: "",
    label: (t) => t("form.phone"),
    placeholder: (t) => t("form.phonePlaceholder"),
    dependencies: [],
    formatter: (value: string) => {
      // Простой форматтер для телефона
      const digits = value.replace(/\D/g, "").slice(0, 11);
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
    label: (t) => t("form.name"),
    placeholder: (t) => t("form.namePlaceholder"),
    isRequired: true,
    dependencies: [],
  },
};