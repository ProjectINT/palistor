"use client";

import { useTranslations } from "next-intl";

import { ValuesJson, type ValuesSource } from "@/modules/shared";

interface StatePreviewProps {
  /** The store's export name, shown as the caption. */
  name: string;
  store: ValuesSource;
}

/** The side panel: every value of the store the active tab edits. */
export function StatePreview({ name, store }: StatePreviewProps) {
  const t = useTranslations("debug");

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6 sticky top-8">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2">{t("valuesTitle")}</h2>
      <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-4">{name}</p>
      <div className="max-h-[60vh] overflow-auto">
        <ValuesJson store={store} />
      </div>
    </div>
  );
}
