"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useStoreContext } from "@palistor/react/useStoreContext";
import { catalogStore } from "@/config/catalog/catalogConfig";

const DEMO_ACCOUNTS = [
  { id: "demo-123", label: "demo-123" },
  { id: "demo-456", label: "demo-456" },
  { id: "acme-prod", label: "acme-prod" },
];

const DEMO_TENANTS = ["acme", "widgets-inc", "dev-org"];

export function StoreContextSection() {
  const t = useTranslations();
  const [accountId, setAccountId] = useState("demo-123");
  const [tenant, setTenant] = useState("acme");

  const ctx = useMemo(() => ({ accountId, tenant } as Record<string, unknown>), [accountId, tenant]);
  useStoreContext(catalogStore, ctx);

  return (
    <div className="space-y-3">
      <div className="text-xs text-zinc-400 dark:text-zinc-500 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg px-3 py-2">
        {t("storeContext.description")}
      </div>

      {/* Current context display */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
        <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-700">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
            {t("storeContext.currentContext")}
          </span>
        </div>
        <div className="px-3 py-2 font-mono text-xs text-zinc-800 dark:text-zinc-200 space-y-1">
          <div>
            <span className="text-blue-500">accountId</span>
            <span className="text-zinc-400">: </span>
            <span className="text-green-600 dark:text-green-400">&quot;{accountId}&quot;</span>
          </div>
          <div>
            <span className="text-blue-500">tenant</span>
            <span className="text-zinc-400">: </span>
            <span className="text-green-600 dark:text-green-400">&quot;{tenant}&quot;</span>
          </div>
        </div>
      </div>

      {/* accountId switcher */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          {t("storeContext.switchAccount")}
        </p>
        <div className="flex flex-wrap gap-2">
          {DEMO_ACCOUNTS.map((acc) => (
            <button
              key={acc.id}
              onClick={() => setAccountId(acc.id)}
              className={`px-3 py-1 rounded-md text-xs font-mono transition-colors ${
                accountId === acc.id
                  ? "bg-blue-500 text-white"
                  : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
              }`}
            >
              {acc.label}
            </button>
          ))}
        </div>
      </div>

      {/* tenant switcher */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          {t("storeContext.switchTenant")}
        </p>
        <div className="flex flex-wrap gap-2">
          {DEMO_TENANTS.map((tn) => (
            <button
              key={tn}
              onClick={() => setTenant(tn)}
              className={`px-3 py-1 rounded-md text-xs font-mono transition-colors ${
                tenant === tn
                  ? "bg-violet-500 text-white"
                  : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
              }`}
            >
              {tn}
            </button>
          ))}
        </div>
      </div>

      {/* Explanation */}
      <p className="text-xs text-zinc-400 dark:text-zinc-500">
        {t("storeContext.resolverNote")}
      </p>
    </div>
  );
}
