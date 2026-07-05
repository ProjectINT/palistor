/**
 * fieldMapping demo — renaming internal field properties to match a specific
 * UI library's convention.
 *
 * By default Palistor exposes `isRequired` / `isDisabled` / `isInvalid` /
 * `errorMessage` / `description`. Many UI kits (MUI, Ant Design, native HTML)
 * expect other names: `required` / `disabled` / `error` / `helperText`.
 *
 * `fieldMapping` renames properties **at the proxy boundary** — GET, SET,
 * tracking and spread. The internal FieldState, compute and pipelines are
 * unchanged. Thanks to that, `{...form.email}` spreads straight into a
 * third-party library component — no adapters.
 */

import { Palistor } from "@palistor/store/store";
import { useForm } from "@palistor/react/useForm";
import { defineFieldMapping } from "@palistor/store/defineFieldMapping";

// ============================================================================
// The rename map (MUI / HTML-native style)
// ============================================================================

/**
 * `defineFieldMapping` (not `: FieldMapping` and not `satisfies FieldMapping`)
 * — so TypeScript keeps the literals (`"required"`, …) and threads them into
 * the `store.proxy` type. Keys on the left are Palistor's internal names,
 * values on the right are the names the properties are exposed under.
 */
export const uiFieldMapping = defineFieldMapping({
  isRequired: "required",
  isDisabled: "disabled",
  isReadOnly: "readOnly",
  isInvalid: "error",
  errorMessage: "helperText",
  description: "helpText",
});

// Table rows for the UI (internal → external)
export const MAPPING_ROWS = Object.entries(uiFieldMapping) as Array<[string, string]>;

// ============================================================================
// Form config
// ============================================================================

export type MappingValues = {
  email: string;
  password: string;
  nickname: string;
};

// The config is authored in the SINGLE public vocabulary of the
// `uiFieldMapping` map (external names): `required` / `readOnly` / `helpText`
// instead of internal `isRequired` / `isReadOnly` / `description`. That's the
// whole point: the field's author and consumer speak the same vocabulary.
// The normalizer in the Palistor constructor converts these names to internal
// before compute — transparently to the author.
// The config is NOT annotated with a type: the validator in the Palistor
// constructor already flags internal names (`isRequired`) as a type error
// when fieldMapping is active, while precise field-value inference (for
// initialValues) is preserved from the literal.
export const mappingConfig = {
  email: {
    value: "",
    label: "Email",
    placeholder: "you@example.com",
    required: true,
    helpText: "We never share your email",
    validate: (v: string) =>
      !v ? "Email is required" : !v.includes("@") ? "Invalid email address" : undefined,
  },
  password: {
    value: "",
    label: "Password",
    placeholder: "••••••••",
    required: true,
    helpText: "At least 8 characters",
    validate: (v: string) =>
      !v ? "Password is required" : v.length < 8 ? "Too short — min 8 characters" : undefined,
  },
  nickname: {
    value: "guest_42",
    label: "Nickname",
    helpText: "Assigned by the server — read-only",
    readOnly: true,
  },
};

// ============================================================================
// Store — enable fieldMapping
// ============================================================================

export const mappingStore = new Palistor({
  config: mappingConfig,
  fieldMapping: uiFieldMapping,
  initialValues: { email: "", password: "", nickname: "guest_42" },
});

/**
 * Hook connecting to the mappingStore. Returns a proxy where fields expose
 * external names: `form.email.required`, `form.email.error`, `form.email.helperText`.
 */
export const useMappingForm = () => useForm(mappingStore) as any;
