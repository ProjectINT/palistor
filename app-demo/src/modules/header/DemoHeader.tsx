"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";

import { LocaleSwitcher } from "./LocaleSwitcher";
import { TabNavigation, type TabType } from "./TabNavigation";
import { ThemeSwitcher } from "./ThemeSwitcher";

type Locale = "ru" | "en";

// The /ssr route is built on the Cube implementation only (next.config.ts).
const HAS_SSR_DEMO = process.env.NEXT_PUBLIC_PALISTOR_SSR_DEMO === "1";

interface DemoHeaderProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
}

export function DemoHeader({
  activeTab,
  onTabChange,
}: DemoHeaderProps) {
  const t = useTranslations();
  const locale = useLocale() as Locale;

  const handleLocaleChange = (newLocale: Locale) => {
    document.cookie = `NEXT_LOCALE=${newLocale}; path=/; max-age=31536000`;
    window.location.reload();
  };

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
        <div className="flex items-center gap-2">
          {HAS_SSR_DEMO && (
            <Link
              href="/ssr"
              className="mr-2 text-sm text-zinc-500 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
            >
              {t("demo.ssrLink")}
            </Link>
          )}
          <ThemeSwitcher />
          <LocaleSwitcher locale={locale} onLocaleChange={handleLocaleChange} />
        </div>
      </div>

      <TabNavigation activeTab={activeTab} onTabChange={onTabChange} />
    </header>
  );
}
