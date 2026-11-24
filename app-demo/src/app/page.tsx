"use client";

import type { ReactNode } from "react";
import { addToast } from "@heroui/react";
import { useTranslations } from "next-intl";
import { useNotifier, useTranslator } from "@palistor";

import { paymentStore } from "@/config/appConfig";
import { catalogStore } from "@/config/catalog/catalogConfig";
import { mappingStore } from "@/config/fieldMapping";
import { flowStore } from "@/config/flow";
import { AsyncDemo } from "@/modules/async-demo";
import { DebugPanel } from "@/modules/debug-panel";
import { FieldMappingDemo } from "@/modules/field-mapping";
import { FlowDemo } from "@/modules/flow-demo";
import { DemoHeader, useTabRouting, type Tab } from "@/modules/header";
import { HooksDemo } from "@/modules/hooks-demo";
import { ListsDemo } from "@/modules/lists-demo";
import { PaymentForm } from "@/modules/payment-form";
import type { ValuesSource } from "@/modules/shared";
import { StatePreview } from "@/modules/state-preview";

/** What each tab renders, and the store the side panel prints next to it. */
const TAB_CONTENT: Record<Tab, { view: ReactNode; storeName: string; store: ValuesSource }> = {
  form: { view: <PaymentForm />, storeName: "paymentStore", store: paymentStore },
  flow: { view: <FlowDemo />, storeName: "flowStore", store: flowStore },
  lists: { view: <ListsDemo />, storeName: "catalogStore", store: catalogStore },
  async: { view: <AsyncDemo />, storeName: "catalogStore", store: catalogStore },
  hooks: { view: <HooksDemo />, storeName: "paymentStore", store: paymentStore },
  mapping: { view: <FieldMappingDemo />, storeName: "mappingStore", store: mappingStore },
  debug: { view: <DebugPanel />, storeName: "paymentStore", store: paymentStore },
};

/** The notifier of the catalog store: a resolver's `onError` calls it as `ctx.notify(message)`. */
const notifyError = (message: string) => addToast({ title: message, color: "danger" });

export default function DemoPage() {
  // The stores are module-level and outlive the tabs: connect them once, here.
  // Config texts are `(t) => t("form.email")`; next-intl's `t` is stable per locale.
  const t = useTranslations();
  useTranslator(paymentStore, t);
  useTranslator(catalogStore, t);
  useNotifier(catalogStore, notifyError);

  const [activeTab, setActiveTab] = useTabRouting();
  const { view, storeName, store } = TAB_CONTENT[activeTab];

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <DemoHeader activeTab={activeTab} onTabChange={setActiveTab} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <main className="lg:col-span-2">{view}</main>
          <aside className="lg:col-span-1">
            <StatePreview name={storeName} store={store} />
          </aside>
        </div>
      </div>
    </div>
  );
}
