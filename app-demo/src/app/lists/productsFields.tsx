"use client";

import { useForm } from "@palistor";
import type { FieldProxyNode } from "@palistor";

import { INPUT_CLASS, LABEL_CLASS } from "@/app/ssr/shared/ui";

// Input adapters of the Products page that /ssr/shared/ui.tsx does not have.
// Each one gets one field node and calls useForm on it, so an edit re-renders
// that input alone. Labels come from the store, translated by it.

/** A compact number input for a row's price: written as typed, the field's formatter makes it a number. */
export function PriceInput({ field, testId }: { field: FieldProxyNode<number>; testId: string }) {
  const f = useForm(field);

  return (
    <input
      data-testid={testId}
      type="number"
      min={0}
      aria-label={f.label}
      value={f.value}
      onChange={(e) => f.onValueChange(e.target.value)}
      className="w-24 px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-right font-mono text-zinc-900 dark:text-zinc-100"
    />
  );
}

/** A labelled number input for a nullable number field (empty input = null, through the field's formatter). */
export function NumberField({ field, testId }: { field: FieldProxyNode<number | null>; testId: string }) {
  const f = useForm(field);

  return (
    <label className="block">
      <span className={LABEL_CLASS}>{f.label}</span>
      <input
        data-testid={testId}
        type="number"
        min={0}
        value={f.value ?? ""}
        onChange={(e) => f.onValueChange(e.target.value)}
        className={INPUT_CLASS}
      />
    </label>
  );
}

/** A checkbox for one boolean field. */
export function CheckboxField({ field, testId }: { field: FieldProxyNode<boolean>; testId: string }) {
  const f = useForm(field);

  return (
    <label className="flex items-center gap-2 h-full pt-6 text-sm text-zinc-700 dark:text-zinc-300">
      <input
        data-testid={testId}
        type="checkbox"
        checked={f.value}
        onChange={(e) => f.onValueChange(e.target.checked)}
        className="w-4 h-4 accent-blue-600"
      />
      {f.label}
    </label>
  );
}
