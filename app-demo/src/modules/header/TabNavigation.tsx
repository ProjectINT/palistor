"use client";

import { useTranslations } from "next-intl";

export type TabType = "form" | "hooks" | "debug" | "lists" | "async" | "mapping" | "flow";

interface TabNavigationProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
}

const TABS: TabType[] = ["form", "flow", "lists", "async", "hooks", "mapping", "debug"];

const TAB_LABELS: Record<TabType, string> = {
  form: "demo.tabs.payment",
  flow: "demo.tabs.flow",
  lists: "demo.tabs.lists",
  async: "demo.tabs.async",
  hooks: "demo.tabs.user",
  mapping: "demo.tabs.mapping",
  debug: "demo.tabs.debug",
};

export function TabNavigation({ activeTab, onTabChange }: TabNavigationProps) {
  const t = useTranslations();

  return (
    <div className="flex gap-2 border-b border-zinc-200 dark:border-zinc-800">
      {TABS.map((tab) => (
        <button
          key={tab}
          onClick={() => onTabChange(tab)}
          className={`
            px-4 py-2 font-medium transition-colors border-b-2 -mb-px
            ${
              activeTab === tab
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
            }
          `}
        >
          {t(TAB_LABELS[tab])}
        </button>
      ))}
    </div>
  );
}
