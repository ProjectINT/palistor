import type { TranslateFn } from "@palistor";
import type { PassportValues, PaymentFormValues } from "./types";

/** A mock server: answers in 0.8 s and fails one save in five. */
async function savePassport(passport: PassportValues): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 800));
  if (Math.random() < 0.2) throw new Error(`Server error: failed to save passport ${passport.number}`);
}

/**
 * A nested group with a submit of its own (the "Save Passport" button). The
 * group's flags see its parent's values (the whole form); the callbacks of the
 * fields inside see the group's values only.
 */
export const passport = {
  passport: {
    isVisible: (values: PaymentFormValues) => values.paymentType === "bank",

    // The server's record id: sent with the payload, no input shows it.
    id: { value: "" },

    number: {
      value: "",
      label: (t: TranslateFn) => t("form.passport.number"),
      placeholder: (t: TranslateFn) => t("form.passport.numberPlaceholder"),
      isRequired: true,
      validate: (value: string, _values: PassportValues, t: TranslateFn) =>
        value.length < 6 ? t("form.passport.numberTooShort") : undefined,
    },

    issueDate: {
      value: "",
      label: (t: TranslateFn) => t("form.passport.issueDate"),
      isRequired: true,
      validate: (value: string, _values: PassportValues, t: TranslateFn) => {
        if (!value) return t("validation.required");
        if (new Date(value) > new Date()) return t("form.passport.issueDateFuture");
      },
    },

    expiryDate: {
      value: "",
      label: (t: TranslateFn) => t("form.passport.expiryDate"),
      // Reads its sibling: `values.issueDate`, not `values.passport.issueDate`.
      validate: (value: string, values: PassportValues, t: TranslateFn) => {
        if (!value) return undefined;
        const expiry = new Date(value);
        if (expiry < new Date()) return t("form.passport.expiryDatePast");
        if (values.issueDate && expiry <= new Date(values.issueDate)) return t("form.passport.expiryDateBeforeIssue");
      },
    },

    // The request gets the number without spaces; the field keeps what was typed.
    beforeSubmit: (values: PassportValues) => ({ ...values, number: values.number.replace(/\s/g, "") }),
    onSubmit: (values: PassportValues) => savePassport(values),
  },
};
