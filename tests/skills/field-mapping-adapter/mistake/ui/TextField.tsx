// Design-system text field (stub). Do not change this file.
// Like most UI kits, it forwards every prop it does not know to the <input>.
// The stub records the names it forwards so the UI tests can see them.
import type { ChangeEvent, InputHTMLAttributes } from "react";

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
  label?: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  /** Error state of the input. */
  error?: boolean;
  /** Hint or error text under the input. */
  helperText?: string;
}

export function TextField({ label, error, helperText, ...input }: TextFieldProps) {
  (globalThis as { __forwardedProps?: string[] }).__forwardedProps?.push(...Object.keys(input));
  return (
    <div>
      <label>
        {label}
        <input {...input} aria-invalid={error || undefined} />
      </label>
      {helperText ? <p className="helper-text">{helperText}</p> : null}
    </div>
  );
}
