"use client";

import { useTranslations } from "next-intl";
import { useForm } from "@palistor";
import type { FieldProxyNode } from "@palistor";

import { paymentStore } from "@/config/appConfig";

/**
 * One field per card, from the store the Payment Form tab edits. The parent
 * hands each card its field; the card calls `useForm(field)` and re-renders
 * only when that field changes.
 */
export function HooksDemo() {
  const t = useTranslations("hooksDemo");
  // The root of the view: picks the fields and reads none, so it never re-renders.
  const form = useForm(paymentStore);

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6 space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{t("title")}</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">{t("description")}</p>
      </div>

      <div className="space-y-4">
        <FieldState name="paymentType" field={form.paymentType} />
        <FieldValue name="cardNumber" field={form.cardNumber} />
        <FieldVisibility name="cardNumber" field={form.cardNumber} />
        <FieldError name="email" field={form.email} />
      </div>
    </div>
  );
}

interface FieldCardProps<T> {
  /** The field's key, for the caption. */
  name: string;
  field: FieldProxyNode<T>;
}

/** Everything a field spread carries. */
function FieldState<T>({ name, field }: FieldCardProps<T>) {
  const f = useForm(field);
  const state = {
    value: f.value,
    label: f.label,
    isVisible: f.isVisible,
    isRequired: f.isRequired,
    isDisabled: f.isDisabled,
    isReadOnly: f.isReadOnly,
    isInvalid: f.isInvalid,
    errorMessage: f.errorMessage,
  };

  return (
    <Card title={`form.${name} — the proxy`} className="bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">
      <pre className="text-xs text-zinc-600 dark:text-zinc-400 overflow-auto">{JSON.stringify(state, null, 2)}</pre>
    </Card>
  );
}

function FieldValue<T>({ name, field }: FieldCardProps<T>) {
  const { value } = useForm(field);

  return (
    <Card title={`form.${name}.value`} className="bg-blue-50 dark:bg-blue-900/20 text-blue-900 dark:text-blue-100">
      <p className="text-sm text-blue-700 dark:text-blue-300">
        Value: <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">{JSON.stringify(value)}</code>
      </p>
    </Card>
  );
}

function FieldVisibility<T>({ name, field }: FieldCardProps<T>) {
  const { isVisible } = useForm(field);

  return (
    <Card title={`form.${name}.isVisible`} className="bg-green-50 dark:bg-green-900/20 text-green-900 dark:text-green-100">
      <p className="text-sm text-green-700 dark:text-green-300">
        isVisible: <span className={isVisible ? "text-green-600" : "text-red-600"}>{String(isVisible)}</span>
      </p>
    </Card>
  );
}

/** Empty until the first submit of the form: errors show only after it. */
function FieldError<T>({ name, field }: FieldCardProps<T>) {
  const { errorMessage } = useForm(field);

  return (
    <Card title={`form.${name}.errorMessage`} className="bg-red-50 dark:bg-red-900/20 text-red-900 dark:text-red-100">
      <p className="text-sm text-red-700 dark:text-red-300">
        Error:{" "}
        {errorMessage ? <code className="bg-red-100 dark:bg-red-800 px-1 rounded">{errorMessage}</code> : "—"}
      </p>
    </Card>
  );
}

function Card({ title, className, children }: { title: string; className: string; children: React.ReactNode }) {
  return (
    <div className={`p-4 rounded-lg ${className}`}>
      <h3 className="font-medium mb-2">{title}</h3>
      {children}
    </div>
  );
}
