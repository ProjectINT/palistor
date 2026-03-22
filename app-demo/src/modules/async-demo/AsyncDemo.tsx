"use client";

import { useTranslations } from "next-intl";
import { LoadingStatesSection } from "./LoadingStatesSection";
import { AutoDepsSection } from "./AutoDepsSection";
import { RetrySection } from "./RetrySection";
import { ResolverStatusSection } from "./ResolverStatusSection";

export function AsyncDemo() {
  const t = useTranslations();

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
          {t("async.title")}
        </h2>
        <p className="text-zinc-500 dark:text-zinc-400 text-sm mb-6">{t("async.subtitle")}</p>

        <div className="space-y-8 divide-y divide-zinc-100 dark:divide-zinc-800">
          <LoadingStatesSection />
          <div className="pt-6">
            <AutoDepsSection />
          </div>
          <div className="pt-6">
            <RetrySection />
          </div>
          <div className="pt-6">
            <ResolverStatusSection />
          </div>
        </div>
      </div>
    </div>
  );
}
