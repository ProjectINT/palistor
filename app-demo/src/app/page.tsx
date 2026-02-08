"use client";

import { useState } from "react";

import { DemoHeader, type TabType } from "@/modules/header";
import { PaymentForm } from "@/modules/payment-form";
import { HooksDemo } from "@/modules/hooks-demo";
import { DebugPanel } from "@/modules/debug-panel";
import { StatePreview } from "@/modules/state-preview";

import { usePaymentForm } from "@/config/paymentForm";

// ============================================================================
// Constants
// ============================================================================

const FORM_ID = "payment-demo";

// ============================================================================
// Demo Page
// ============================================================================

export default function DemoPage() {
  const [activeTab, setActiveTab] = useState<TabType>("form");

  // Корневой компонент — инициализирует форму с колбэками
  usePaymentForm(FORM_ID, {
    persistId: "PaymentDemo:payment-demo",
    onChange: ({ fieldKey, newValue, previousValue }) => {
      console.log(`[onChange] ${String(fieldKey)}: ${previousValue} → ${newValue}`);
    },
    onSubmit: async (values) => {
      console.log("[onSubmit] Submitting form with values:", values);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      alert("Форма успешно отправлена!");
    },
    afterSubmit: (data, reset) => {
      console.log("[afterSubmit] Form submitted, data:", data);
    },
  });

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
            {activeTab === "form" && <PaymentForm formId={FORM_ID} />}
            {activeTab === "hooks" && <HooksDemo formId={FORM_ID} />}
            {activeTab === "debug" && <DebugPanel formId={FORM_ID} />}
          </div>

          {/* Side Panel */}
          <div className="lg:col-span-1">
            <StatePreview formId={FORM_ID} />
          </div>
        </div>
      </div>
    </div>
  );
}
