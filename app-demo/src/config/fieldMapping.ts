/**
 * The "Field Mapping" tab: field props renamed to the names of an MUI-style /
 * native-HTML input (`required`, `error`, `helperText`, …).
 *
 * With a map active the store speaks one vocabulary: the config is written in
 * the map's names and the fields are read in them, so a field spreads straight
 * into an adapter that uses those names (components/NativeField.tsx).
 */

import { Palistor, defineFieldMapping } from "@palistor";

// palistor's name → the input's name. defineFieldMapping keeps the literal
// types, so `form.email.required` is typed (an annotation would widen them).
export const uiFieldMapping = defineFieldMapping({
  isRequired: "required",
  isDisabled: "disabled",
  isReadOnly: "readOnly",
  isInvalid: "error",
  errorMessage: "helperText",
  description: "helpText",
});

export const mappingStore = new Palistor({
  config: {
    // `required` / `readOnly` / `helpText`: the internal names would not compile, and would throw.
    email: {
      value: "",
      label: "Email",
      placeholder: "you@example.com",
      required: true,
      helpText: "We never share your email",
      validate: (value: string) =>
        !value ? "Email is required" : !value.includes("@") ? "Invalid email address" : undefined,
    },
    password: {
      value: "",
      label: "Password",
      placeholder: "••••••••",
      required: true,
      helpText: "At least 8 characters",
      validate: (value: string) =>
        !value ? "Password is required" : value.length < 8 ? "Too short — min 8 characters" : undefined,
    },
    nickname: {
      value: "guest_42",
      label: "Nickname",
      readOnly: true,
      helpText: "Assigned by the server — read-only",
    },
  },
  fieldMapping: uiFieldMapping,
});
