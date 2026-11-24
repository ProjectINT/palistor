"use client";

import { useTranslations } from "next-intl";

import { TABS, TAB_LABELS, type Tab } from "./tabs";

interface TabNavigationProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}

export function TabNavigation({ activeTab, onTabChange }: TabNavigationProps) {
  const t = useTranslations();

  return (
    <nav className="flex gap-2 border-b border-zinc-200 dark:border-zinc-800">
      {TABS.map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => onTabChange(tab)}
          aria-current={tab === activeTab ? "page" : undefined}
          className={`px-4 py-2 font-medium transition-colors border-b-2 -mb-px ${
            tab === activeTab
              ? "border-blue-500 text-blue-600 dark:text-blue-400"
              : "border-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
          }`}
        >
          {t(TAB_LABELS[tab])}
        </button>
      ))}
    </nav>
  );
}
