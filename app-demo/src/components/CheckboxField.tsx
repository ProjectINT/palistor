"use client";

import type { ComponentProps, ReactNode } from "react";
import { Checkbox } from "@heroui/react";
import { useForm } from "@palistor";
import type { FieldProxyNode } from "@palistor";

type CheckboxProps = Omit<ComponentProps<typeof Checkbox>, keyof FieldProxyNode | "field" | "isSelected" | "children">;

interface CheckboxFieldProps extends CheckboxProps {
  /** The field this checkbox edits, handed down by the parent. */
  field: FieldProxyNode<boolean>;
  /** The text next to the box; the field's label by default. */
  children?: ReactNode;
}

/**
 * A HeroUI Checkbox on one boolean field, with the error (or the description)
 * under it. Calls `useForm` on its own field, like TextField.
 */
export function CheckboxField({ field, children, ...checkboxProps }: CheckboxFieldProps) {
  const f = useForm(field);
  if (!f.isVisible) return null;

  const hint = f.isInvalid ? f.errorMessage : f.description;

  return (
    <div className="flex flex-col gap-1">
      <Checkbox
        isSelected={f.value}
        onValueChange={f.onValueChange}
        isRequired={f.isRequired}
        isReadOnly={f.isReadOnly}
        isDisabled={f.isDisabled}
        isInvalid={!!f.isInvalid}
        {...checkboxProps}
      >
        {children ?? f.label}
      </Checkbox>
      {hint && <p className={`text-xs px-1 ${f.isInvalid ? "text-danger" : "text-default-500"}`}>{hint}</p>}
    </div>
  );
}
