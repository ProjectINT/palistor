"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";

import { lastCustomerRequest, subscribeCustomerRequests } from "./backend";

/**
 * The last request the customers endpoint received, as a URL line: what
 * `$toParams` made of the filter values, plus the page window. Instrumentation
 * like the counters, not store state: the endpoint logs it (backend.ts). The
 * server snapshot — also used by the render that hydrates the server's HTML —
 * is "none yet".
 */
export function LastRequest() {
  const t = useTranslations("lists.customers.customers");
  const request = useSyncExternalStore(subscribeCustomerRequests, lastCustomerRequest, () => null);

  return (
    <p className="flex flex-wrap items-baseline gap-2 text-xs text-zinc-500 dark:text-zinc-400">
      <span>{t("lastRequest")}:</span>
      <code
        data-testid="lists-customers-query"
        className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 font-mono text-zinc-700 dark:text-zinc-300 break-all"
      >
        {request ?? t("noRequest")}
      </code>
    </p>
  );
}
