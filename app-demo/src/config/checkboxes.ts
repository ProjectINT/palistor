import type { TranslateFn, FormConfig } from "@palistor/core/types";
import type { PaymentFormValues } from "./types";

export const checkboxes: Pick<FormConfig<PaymentFormValues>, 'agreeTerms' | 'newsletter'> = {
  agreeTerms: {
    types: {
      dataType: "Boolean" as const,
      type: "boolean"
    },
    value: false,
    label: (t: TranslateFn) => t("form.agreeTerms"),
    description: (t: TranslateFn) => t("form.agreeTermsDescription"),
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
    label: (t: TranslateFn) => t("form.newsletter"),
    description: (t: TranslateFn) => t("form.newsletterDescription"),
    dependencies: [],
  },
};