import type { TranslateFn } from "@palistor";
import type { PaymentFormValues } from "./types";

export const checkboxes = {
  agreeTerms: {
    value: false,
    label: (t: TranslateFn) => t("form.agreeTerms"),
    description: (t: TranslateFn) => t("form.agreeTermsDescription"),
    isRequired: true,
    // `false` counts as filled for isRequired: a box that must be checked needs `validate`.
    validate: (value: boolean, _values: PaymentFormValues, t: TranslateFn) =>
      value ? undefined : t("validation.required"),
  },

  newsletter: {
    value: false,
    label: (t: TranslateFn) => t("form.newsletter"),
    description: (t: TranslateFn) => t("form.newsletterDescription"),
  },
};
