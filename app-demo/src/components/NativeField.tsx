import type { HTMLInputTypeAttribute } from "react";
import type { ApplyFieldMapping, FieldProxyNode } from "@palistor";

import type { uiFieldMapping } from "@/config/fieldMapping";

/** A string field under the names of `uiFieldMapping`: exactly what `{...form.email}` carries. */
export type NativeFieldProps = ApplyFieldMapping<FieldProxyNode<string>, typeof uiFieldMapping> & {
  type?: HTMLInputTypeAttribute;
};

/**
 * The one adapter for text fields of the mapped store. Its props already use
 * the input's names, so a call site is a plain spread: `<NativeField {...form.email} />`.
 * What a rename cannot do happens here: `onValueChange` from the change event,
 * one hint out of two texts, `aria-invalid` from `error`.
 */
export function NativeField(props: NativeFieldProps) {
  const { isVisible, label, value, onValueChange, placeholder, type = "text" } = props;
  const { required, disabled, readOnly, error, helperText, helpText } = props;
  if (!isVisible) return null;

  return (
    <label className="block">
      {label && (
        <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </span>
      )}

      <input
        type={type}
        value={value}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        readOnly={readOnly}
        aria-invalid={error || undefined}
        onChange={(e) => onValueChange(e.target.value)}
        className={`
          w-full rounded-lg border px-3 py-2 text-sm bg-white dark:bg-zinc-800
          text-zinc-900 dark:text-zinc-100 outline-none transition-colors
          disabled:opacity-50 read-only:bg-zinc-100 dark:read-only:bg-zinc-900
          ${
            error
              ? "border-red-500 focus:border-red-500 focus:ring-1 focus:ring-red-500"
              : "border-zinc-300 dark:border-zinc-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          }
        `}
      />

      {/* The error replaces the help text while the field is invalid. */}
      {error ? (
        <span className="block text-xs text-red-500 mt-1">{helperText}</span>
      ) : helpText ? (
        <span className="block text-xs text-zinc-400 dark:text-zinc-500 mt-1">{helpText}</span>
      ) : null}
    </label>
  );
}
