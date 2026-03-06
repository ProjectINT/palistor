import type { FormConfig } from "@palistor";
import type { PaymentFormValues } from "./types";

export const checkboxes: Pick<FormConfig<PaymentFormValues>, 'agreeTerms' | 'newsletter'> = {
  agreeTerms: {
    types: {
      dataType: "Boolean" as const,
      type: "boolean"
    },
    value: false,
    label: (t) => t("form.agreeTerms"),
    description: (t) => t("form.agreeTermsDescription"),
    isRequired: true,
    dependencies: [],
    validate: (value: boolean) => {
      if (!value) {
        return "validation.required";
      }
    },
  },
  newsletter: {
    types: {
      dataType: "Boolean" as const,
      type: "boolean"
    },
    value: false,
    label: (t) => t("form.newsletter"),
    description: (t) => t("form.newsletterDescription"),
    dependencies: [],
  },
};