"use client";

import type { ComponentProps } from "react";
import { Select, SelectItem } from "@heroui/react";
import { useForm } from "@palistor";
import type { FieldProxyNode } from "@palistor";

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  isDisabled?: boolean;
}

type SelectProps = Omit<
  ComponentProps<typeof Select>,
  keyof FieldProxyNode | "field" | "options" | "children" | "items" | "selectedKeys" | "onSelectionChange"
>;

interface SelectFieldProps<T extends string> extends SelectProps {
  /** The field this select edits, handed down by the parent. */
  field: FieldProxyNode<T>;
  options: ReadonlyArray<SelectOption<T>>;
}

/**
 * A HeroUI Select on one string field (a union of literals included). Like
 * TextField, it calls `useForm` on its own field.
 */
export function SelectField<T extends string>({ field, options, ...selectProps }: SelectFieldProps<T>) {
  const f = useForm(field);
  if (!f.isVisible) return null;

  // The write type of a field is computed from its value type, which TypeScript
  // cannot do for a generic T. Every key below is one of the options, so a T.
  const select = f.onValueChange as (value: T) => void;

  return (
    <Select
      label={f.label}
      placeholder={f.placeholder}
      description={f.description}
      selectedKeys={f.value ? [f.value] : []}
      onSelectionChange={(keys) => {
        const [key] = keys === "all" ? [] : keys;
        if (key !== undefined) select(String(key) as T);
      }}
      isRequired={f.isRequired}
      isDisabled={f.isDisabled}
      isInvalid={!!f.isInvalid}
      errorMessage={f.errorMessage}
      {...selectProps}
    >
      {options.map((option) => (
        <SelectItem key={option.value} isDisabled={option.isDisabled}>
          {option.label}
        </SelectItem>
      ))}
    </Select>
  );
}
