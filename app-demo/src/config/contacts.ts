import type { TranslateFn } from "@palistor";
import type { PaymentFormValues } from "./types";

/** "15551234567" → "+1 (555) 123-45-67", built up as the digits are typed. */
function formatPhone(raw: unknown): string {
  const d = String(raw).replace(/\D/g, "").slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 1) return `+${d}`;
  if (d.length <= 4) return `+${d[0]} (${d.slice(1)}`;
  if (d.length <= 7) return `+${d[0]} (${d.slice(1, 4)}) ${d.slice(4)}`;
  if (d.length <= 9) return `+${d[0]} (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return `+${d[0]} (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}`;
}

export const contacts = {
  name: {
    value: "",
    label: (t: TranslateFn) => t("form.name"),
    placeholder: (t: TranslateFn) => t("form.namePlaceholder"),
    isRequired: true,
    // Without `validate` an empty required field reports the bare "required".
    validate: (value: string, _values: PaymentFormValues, t: TranslateFn) =>
      value.trim() ? undefined : t("validation.required"),
  },

  email: {
    value: "",
    label: (t: TranslateFn) => t("form.email"),
    placeholder: (t: TranslateFn) => t("form.emailPlaceholder"),
    isRequired: true,
    validate: (value: string, _values: PaymentFormValues, t: TranslateFn) =>
      value.includes("@") ? undefined : t("validation.email"),
    // Runs after every write of the field; the returned patch goes to the form.
    onChange: async () => ({ lastModified: Date.now() }),
  },

  phone: {
    value: "",
    label: (t: TranslateFn) => t("form.phone"),
    placeholder: (t: TranslateFn) => t("form.phonePlaceholder"),
    formatter: formatPhone,
  },

  /** When the email last changed: written by `email.onChange`, has no input. */
  lastModified: { value: 0 },
};
