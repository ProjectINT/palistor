"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { useTranslator } from "@palistor/react/useTranslator";
import { useNotifier } from "@palistor/react/useNotifier";
import { paymentStore } from "@/config/appConfig";
import { catalogStore } from "@/config/catalog/catalogConfig";

import { DemoHeader, type TabType } from "@/modules/header";
import { PaymentForm } from "@/modules/payment-form";
import { HooksDemo } from "@/modules/hooks-demo";
import { DebugPanel } from "@/modules/debug-panel";
import { StatePreview } from "@/modules/state-preview/StatePreview";
import { ListsDemo } from "@/modules/lists-demo";
import { AsyncDemo } from "@/modules/async-demo";
import { FieldMappingDemo } from "@/modules/field-mapping";

// ============================================================================
// Demo Page
// ============================================================================

export default function DemoPage() {
  const t = useTranslations();
  useTranslator(paymentStore, t);
  useTranslator(catalogStore, t);
  // usePersist is now managed inside PersistControls (inside PaymentForm tab)

  const [toasts, setToasts] = useState<Array<{ id: number; message: string }>>([]);
  const addToast = useCallback((message: string) => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((n) => n.id !== id)), 4000);
  }, []);
  useNotifier(catalogStore, addToast);

  const [activeTab, setActiveTab] = useState<TabType>("form");

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <DemoHeader
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2">
            {activeTab === "form" && <PaymentForm />}
            {activeTab === "lists" && <ListsDemo />}
            {activeTab === "async" && <AsyncDemo />}
            {activeTab === "hooks" && <HooksDemo />}
            {activeTab === "mapping" && <FieldMappingDemo />}
            {activeTab === "debug" && <DebugPanel />}
          </div>

          {/* Side Panel */}
          <div className="lg:col-span-1">
            <StatePreview activeTab={activeTab} />
          </div>
        </div>
      </div>

      {/* Notification toasts (from useNotifier — triggered by resolve onError) */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 space-y-2 z-50">
          {toasts.map((n) => (
            <div
              key={n.id}
              className="flex items-center gap-2 bg-red-600 text-white px-4 py-3 rounded-lg shadow-lg text-sm max-w-xs animate-in fade-in slide-in-from-bottom-2"
            >
              <span className="text-red-200">✕</span>
              {n.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

