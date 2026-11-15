// Design-system checkbox (stub). Do not change this file.
// Like most UI kits, it forwards every prop it does not know to the <input>.
// The stub records the names it forwards so the UI tests can see them.
import type { ChangeEvent, InputHTMLAttributes } from "react";

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "checked" | "onChange" | "type"> {
  label?: string;
  checked: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}

export function Checkbox({ label, ...input }: CheckboxProps) {
  (globalThis as { __forwardedProps?: string[] }).__forwardedProps?.push(...Object.keys(input));
  return (
    <label>
      <input type="checkbox" {...input} />
      {label}
    </label>
  );
}
