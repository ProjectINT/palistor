"use client";

import { useTranslations } from "next-intl";
import { Button } from "@heroui/react";

import type { CatalogContext } from "@/config/catalog/types";
import { Hint } from "./ui";

const ACCOUNTS = ["demo-123", "demo-456", "acme-prod"];
const TENANTS = ["acme", "widgets-inc", "dev-org"];

/**
 * Shows and switches the store context. The tab root owns the value and hands
 * it to `useStoreContext`; this component only renders it.
 */
export function StoreContextSection({
  context,
  onChange,
}: {
  context: CatalogContext;
  onChange: (patch: Partial<CatalogContext>) => void;
}) {
  const t = useTranslations("storeContext");

  return (
    <div className="space-y-3">
      <Hint>{t("description")}</Hint>

      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
        <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-700">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
            {t("currentContext")}
          </span>
        </div>
        <div className="px-3 py-2 font-mono text-xs text-zinc-800 dark:text-zinc-200 space-y-1">
          {Object.entries(context).map(([key, value]) => (
            <div key={key}>
              <span className="text-blue-500">{key}</span>
              <span className="text-zinc-400">: </span>
              <span className="text-green-600 dark:text-green-400">&quot;{value}&quot;</span>
            </div>
          ))}
        </div>
      </div>

      <Switcher
        label={t("switchAccount")}
        options={ACCOUNTS}
        value={context.accountId}
        onSelect={(accountId) => onChange({ accountId })}
      />
      <Switcher
        label={t("switchTenant")}
        options={TENANTS}
        value={context.tenant}
        onSelect={(tenant) => onChange({ tenant })}
      />

      <p className="text-xs text-zinc-400 dark:text-zinc-500">{t("resolverNote")}</p>
    </div>
  );
}

function Switcher({
  label,
  options,
  value,
  onSelect,
}: {
  label: string;
  options: string[];
  value: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Button
            key={option}
            size="sm"
            className="font-mono"
            color={option === value ? "primary" : "default"}
            variant={option === value ? "solid" : "flat"}
            aria-pressed={option === value}
            onPress={() => onSelect(option)}
          >
            {option}
          </Button>
        ))}
      </div>
    </div>
  );
}
