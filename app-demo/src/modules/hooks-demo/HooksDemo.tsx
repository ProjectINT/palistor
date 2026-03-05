"use client";

import { useTranslations } from "next-intl";

import { FieldStateDemo } from "./FieldStateDemo";
import { FieldValueDemo } from "./FieldValueDemo";
import { FieldVisibleDemo } from "./FieldVisibleDemo";
import { FieldErrorDemo } from "./FieldErrorDemo";

export function HooksDemo() {
  const t = useTranslations();

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6 space-y-6">
      <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
        {t("hooksDemo.title")}
      </h2>

      <div className="space-y-4">
        <FieldStateDemo fieldKey="paymentType" />
        <FieldValueDemo fieldKey="cardNumber" />
        <FieldVisibleDemo fieldKey="cardNumber" />
        <FieldErrorDemo fieldKey="email" />
      </div>
    </div>
  );
}
