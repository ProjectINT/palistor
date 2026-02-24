"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useTranslator } from "@palistor/react/useTranslator";
import { paymentStore } from "@/config/paymentForm";

import { DemoHeader, type TabType } from "@/modules/header";
import { PaymentForm } from "@/modules/payment-form";
import { HooksDemo } from "@/modules/hooks-demo";
import { DebugPanel } from "@/modules/debug-panel";
import { StatePreview } from "@/modules/state-preview/StatePreview";

// ============================================================================
// Demo Page
// ============================================================================

export default function DemoPage() {
  const t = useTranslations();
  useTranslator(paymentStore, t);

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
            {activeTab === "hooks" && <HooksDemo />}
            {activeTab === "debug" && <DebugPanel />}
          </div>

          {/* Side Panel */}
          <div className="lg:col-span-1">
            <StatePreview />
          </div>
        </div>
      </div>
    </div>
  );
}

