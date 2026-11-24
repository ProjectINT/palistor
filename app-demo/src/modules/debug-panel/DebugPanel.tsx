"use client";

import { useTranslations } from "next-intl";
import { useForm } from "@palistor";
import type { GroupProxyNode } from "@palistor";

import { catalogStore } from "@/config/catalog/catalogConfig";
import { paymentStore } from "@/config/appConfig";
import { ValuesJson } from "@/modules/shared";

/** Both stores of the demo at a glance: the payment form's own state and values, the catalog's lists. */
export function DebugPanel() {
  const t = useTranslations("debug");
  // The root of the view. It hands the payment form down and reads only the
  // catalog lists' lengths — a first read, which starts a list's lazy resolve.
  const payment = useForm(paymentStore);
  const catalog = useForm(catalogStore);

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6 space-y-6">
      <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{t("stateTitle")}</h2>

      <div className="space-y-3">
        <h3 className="font-medium text-zinc-700 dark:text-zinc-300">paymentStore — {t("fieldsTitle")}</h3>
        <FormFlags form={payment} />
        <div className="max-h-80 overflow-auto">
          <ValuesJson store={paymentStore} />
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="font-medium text-zinc-700 dark:text-zinc-300">catalogStore — lists & entities</h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Stat label="Users" value={catalog.users.length} />
          <Stat label="Products" value={catalog.products.length} />
        </div>
        <div className="max-h-80 overflow-auto">
          <ValuesJson store={catalogStore} />
        </div>
      </div>
    </div>
  );
}

/** The flags every group has, here of the root: re-renders when one of them flips, not on every edit. */
function FormFlags({ form }: { form: GroupProxyNode }) {
  const t = useTranslations("debug");
  const { dirty, submitting, revalidate } = useForm(form);

  return (
    <div className="grid grid-cols-3 gap-3 text-sm">
      <Stat label={t("dirty")} value={String(dirty)} />
      <Stat label={t("submitting")} value={String(submitting)} />
      <Stat label={t("showErrors")} value={String(revalidate)} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="p-2 rounded bg-zinc-50 dark:bg-zinc-800">
      <span className="text-zinc-500 dark:text-zinc-400">{label}: </span>
      <strong>{value}</strong>
    </div>
  );
}
