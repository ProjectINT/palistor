"use client";

import { useTranslations } from "next-intl";
import { PalistorProvider } from "@palistor";

// A module-level object: the provider compares the context per key anyway,
// but a stable reference costs nothing.
const CONTEXT = { workspace: "compilers-lab" };

/**
 * Shared values for every `usePalistor` store of the /ssr route, rendered by
 * the page (page.cube.tsx). It sits below the root layout's IntlProvider, so
 * the translator is next-intl's `t`: the stores get it in their constructor
 * and the server's HTML is translated.
 */
export function SsrProviders({ children }: { children: React.ReactNode }) {
  const t = useTranslations();

  return (
    <PalistorProvider translator={t} context={CONTEXT}>
      {children}
    </PalistorProvider>
  );
}
