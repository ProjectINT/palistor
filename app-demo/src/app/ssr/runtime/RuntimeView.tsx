"use client";

import { useTranslations } from "next-intl";

import { SsrShell } from "../shared/SsrShell";
import type { Teammate } from "./backend";
import { ContextBlock } from "./ContextBlock";
import { EagerBlock } from "./EagerBlock";
import { InstancesBlock } from "./InstancesBlock";
import { ServerModeBlock } from "./ServerModeBlock";

/**
 * The client side of /ssr/runtime: when a store starts its resolvers, where a
 * store lives and how the provider's context reaches it. Each block builds
 * its own store with usePalistor; the page's <SsrProviders> gives them the
 * translator, the notifier and `workspace`.
 *
 *   1. ServerModeBlock — server mode and store.start(), made visible in the browser;
 *   2. EagerBlock      — what the browser does instead: usePalistor starts the store after the first commit;
 *   3. InstancesBlock  — one store per component instance, request data as initialData;
 *   4. ContextBlock    — a nested provider's context, followed live.
 */
export function RuntimeView({ teammates }: { teammates: Teammate[] }) {
  const t = useTranslations("ssr.runtime");

  return (
    <SsrShell subtitle={t("subtitle")}>
      <ServerModeBlock />
      <EagerBlock />
      <InstancesBlock teammates={teammates} />
      <ContextBlock />
    </SsrShell>
  );
}
