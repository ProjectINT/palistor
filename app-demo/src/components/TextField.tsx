"use client";

import type { ComponentProps } from "react";
import { Input } from "@heroui/react";
import { useForm } from "@palistor";
import type { FieldProxyNode } from "@palistor";

type InputProps = Omit<ComponentProps<typeof Input>, keyof FieldProxyNode | "field">;

interface TextFieldProps extends InputProps {
  /** The field this input edits, handed down by the parent. */
  field: FieldProxyNode<string> | FieldProxyNode<number>;
}

/**
 * A HeroUI Input on one field. It calls `useForm` on the field it was given,
 * so a keystroke re-renders this component alone, not the section around it.
 *
 * A number field is shown as text; its config `formatter` turns what is typed
 * back into a number. Extra props (`type`, `startContent`, …) go to the Input.
 */
export function TextField({ field, ...inputProps }: TextFieldProps) {
  const f = useForm(field);
  if (!f.isVisible) return null;

  return (
    <Input
      label={f.label}
      placeholder={f.placeholder}
      description={f.description}
      value={String(f.value ?? "")}
      onValueChange={f.onValueChange}
      isRequired={f.isRequired}
      isReadOnly={f.isReadOnly}
      isDisabled={f.isDisabled}
      isInvalid={!!f.isInvalid}
      errorMessage={f.errorMessage}
      {...inputProps}
    />
  );
}
