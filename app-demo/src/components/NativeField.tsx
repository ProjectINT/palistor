/**
 * NativeField — deliberately knows NOTHING about Palistor.
 *
 * A styled input in the MUI / native-HTML spirit: it accepts props
 * `required` / `disabled` / `readOnly` / `error` / `helperText` / `helpText`
 * — the very names `fieldMapping` renames Palistor's internal properties
 * into. So it can be rendered with a plain spread:
 *
 *   <NativeField {...form.email} />
 *
 * No `required={form.email.isRequired}` adapters — the spread matches
 * one-to-one.
 */

export interface NativeFieldProps {
  // Palistor properties that are not renamed
  label?: string;
  value?: string;
  placeholder?: string;
  onValueChange?: (v: string) => void;
  isVisible?: boolean;
  // renamed via fieldMapping (MUI / native style)
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  error?: boolean;
  helperText?: string;
  helpText?: string;
  // leftover spread keys (dirty, loading, componentProps…) — ignored
  [key: string]: unknown;
}

export function NativeField({
  label,
  value = "",
  placeholder,
  onValueChange,
  isVisible = true,
  required,
  disabled,
  readOnly,
  error,
  helperText,
  helpText,
}: NativeFieldProps) {
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
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        aria-invalid={error || undefined}
        onChange={(e) => onValueChange?.(e.target.value)}
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

      {/* helperText (from errorMessage) takes priority, otherwise helpText (from description) */}
      {error && helperText ? (
        <span className="block text-xs text-red-500 mt-1">{helperText}</span>
      ) : helpText ? (
        <span className="block text-xs text-zinc-400 dark:text-zinc-500 mt-1">{helpText}</span>
      ) : null}
    </label>
  );
}
