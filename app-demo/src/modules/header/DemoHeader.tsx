"use client";

import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";

import { LocaleSwitcher } from "./LocaleSwitcher";
import { TabNavigation, type TabType } from "./TabNavigation";

type Locale = "ru" | "en";

interface DemoHeaderProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
}

export function DemoHeader({
  activeTab,
  onTabChange,
}: DemoHeaderProps) {
  const t = useTranslations();

  return (
    <header className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
            {t("demo.title")}
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400 mt-1">
            {t("demo.subtitle")}
          </p>
        </div>
      </div>

      <TabNavigation activeTab={activeTab} onTabChange={onTabChange} />
    </header>
  );
}
