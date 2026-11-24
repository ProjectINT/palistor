"use client";

import { useForm } from "@palistor";
import type { FieldProxyNode } from "@palistor";

// The controls and small pieces every /ssr route uses. A field component gets
// one field node from its parent and calls useForm on it, so a keystroke
// re-renders that component alone. Its label comes from the store: translated
// in the server's HTML too.

export const LABEL_CLASS = "block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1";

export const INPUT_CLASS =
  "w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-zinc-900 dark:text-zinc-100";

// `read-only:` only on text controls: a <select> always matches :read-only.
const TEXT_INPUT_CLASS = `${INPUT_CLASS} read-only:bg-zinc-50 read-only:text-zinc-500 dark:read-only:bg-zinc-900 dark:read-only:text-zinc-400`;

export function buttonClass(tone: "primary" | "neutral" | "danger"): string {
  const tones = {
    primary: "bg-blue-600 hover:bg-blue-700 text-white",
    neutral:
      "bg-zinc-100 hover:bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-100",
    danger: "bg-red-50 hover:bg-red-100 text-red-700 dark:bg-red-950 dark:hover:bg-red-900 dark:text-red-300",
  };
  return `px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${tones[tone]}`;
}

/** A text input (or a textarea) for one string field: label, required mark, read-only, error after a submit. */
export function TextField({
  field,
  testId,
  type = "text",
  multiline = false,
}: {
  field: FieldProxyNode<string>;
  testId: string;
  type?: "text" | "email";
  multiline?: boolean;
}) {
  const f = useForm(field);
  const control = {
    value: f.value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => f.onValueChange(e.target.value),
    readOnly: f.isReadOnly,
    placeholder: f.placeholder,
    "aria-invalid": f.isInvalid,
    className: TEXT_INPUT_CLASS,
  };

  return (
    <label className="block">
      <span className={LABEL_CLASS}>
        {f.label}
        {f.isRequired && <span className="text-red-500"> *</span>}
      </span>
      {multiline ? <textarea data-testid={testId} rows={3} {...control} /> : <input data-testid={testId} type={type} {...control} />}
      {/* isInvalid stays undefined until the first submit: no error before it. */}
      {f.isInvalid && (
        <span data-testid={`${testId}-error`} role="alert" className="mt-1 block text-xs text-red-600 dark:text-red-400">
          {f.errorMessage}
        </span>
      )}
    </label>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

/** A <select> for one string field; the options are the caller's (the store holds the value only). */
export function SelectField({
  field,
  testId,
  options,
}: {
  field: FieldProxyNode<string>;
  testId: string;
  options: readonly SelectOption[];
}) {
  const f = useForm(field);

  return (
    <label className="block">
      <span className={LABEL_CLASS}>{f.label}</span>
      <select
        data-testid={testId}
        value={f.value}
        onChange={(e) => f.onValueChange(e.target.value)}
        className={INPUT_CLASS}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** "name: value" for a piece of state (`loading`, `dirty`, `resolveStatus`, a context key); the value carries the test id. */
export function Flag({ name, value, testId }: { name: string; value: boolean | string | null; testId: string }) {
  const busy = value === "pending" || (name === "loading" && value === true);
  const alert = !busy && (value === true || value === "error");
  const tone = alert
    ? "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800"
    : busy
      ? "bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800"
      : "bg-white text-zinc-600 border-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:border-zinc-700";

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border font-mono text-xs ${tone}`}>
      {name}: <span data-testid={testId}>{String(value)}</span>
    </span>
  );
}

export function Spinner({ testId, className = "" }: { testId?: string; className?: string }) {
  return (
    <span
      data-testid={testId}
      className={`inline-block w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin align-middle ${className}`}
    />
  );
}

/** What a node shows while `loading`: grey rows, with an optional line of text above them. */
export function Skeleton({ testId, rows = 2, label }: { testId: string; rows?: number; label?: string }) {
  return (
    <div data-testid={testId} aria-busy="true" className="space-y-1">
      {label && (
        <p className="flex items-center gap-2 pb-1 text-sm text-zinc-500 dark:text-zinc-400">
          <Spinner />
          {label}
        </p>
      )}
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-10 rounded-lg bg-zinc-200/70 dark:bg-zinc-700/60 animate-pulse" />
      ))}
    </div>
  );
}
