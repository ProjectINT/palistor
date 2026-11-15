import { Palistor, defineFieldMapping, useForm } from "palistor";
import type { ApplyFieldMapping, FieldProxyNode } from "palistor";
import { saveProfile, type ProfileValues } from "./api";
import { Checkbox } from "./ui/Checkbox";
import { TextField } from "./ui/TextField";

// One vocabulary for the whole form: the design system's prop names.
const fieldMapping = defineFieldMapping({
  isRequired: "required",
  isDisabled: "disabled",
  isReadOnly: "readOnly",
  isInvalid: "error",
  errorMessage: "helperText",
  description: "helpText",
});

export const profileStore = new Palistor({
  // With a map active the config is written in the mapped names:
  // required / readOnly / helpText, never isRequired / isReadOnly / description.
  config: {
    email: {
      value: "",
      label: "Email",
      required: true,
      helpText: "We never share it",
      validate: (v: string) => (v.includes("@") ? undefined : "Enter a valid email"),
    },
    nickname: { value: "guest_42", label: "Nickname", readOnly: true },
    hasCompany: { value: false, label: "I represent a company" },
    company: {
      value: "",
      label: "Company",
      isVisible: (values: ProfileValues) => values.hasCompany,
      // Same predicate as isVisible: a hidden required field would still block the submit.
      required: (values: ProfileValues) => values.hasCompany,
    },
    onSubmit: (values: ProfileValues) => saveProfile(values),
  },
  fieldMapping,
});

// One adapter per input kind; its props are a whole field in the mapped names.
type TextProps = ApplyFieldMapping<FieldProxyNode<string>, typeof fieldMapping> & { type?: string };

function TextInput(props: TextProps) {
  // Consume everything the design system does not accept, forward the rest.
  const { isVisible, onValueChange, error, helperText, helpText, ...rest } = props;
  if (!isVisible) return null;
  return (
    <TextField
      {...rest}
      error={!!error}
      helperText={error ? helperText : helpText}
      onChange={(e) => onValueChange(e.target.value)}
    />
  );
}

type CheckProps = ApplyFieldMapping<FieldProxyNode<boolean>, typeof fieldMapping>;

function CheckInput({ isVisible, value, onValueChange, label, disabled }: CheckProps) {
  if (!isVisible) return null;
  // The value-shape conversion (value → checked, event → value) lives in the adapter.
  return (
    <Checkbox
      label={label}
      checked={value}
      disabled={disabled}
      onChange={(e) => onValueChange(e.target.checked)}
    />
  );
}

export function ProfileForm() {
  const form = useForm(profileStore);
  return (
    <div>
      <TextInput {...form.email} type="email" />
      <TextInput {...form.nickname} />
      <CheckInput {...form.hasCompany} />
      <TextInput {...form.company} />
      <button type="button" onClick={() => form.submit()}>
        Save
      </button>
    </div>
  );
}
