"use client";

import { useSyncExternalStore } from "react";
import { NextIntlClientProvider } from "next-intl";

import { DEFAULT_LOCALE, MESSAGES, TIME_ZONE, readLocale } from "@/i18n/locale";

// The locale changes only through a reload (switchLocale): nothing to subscribe to.
const subscribe = () => () => {};

/**
 * next-intl for the static export: both message sets are bundled, and the
 * locale comes from a cookie on the client. The prerendered HTML is in the
 * default locale; the server snapshot keeps the hydrating render on it, then
 * React renders again in the saved one.
 */
export function IntlProvider({ children }: { children: React.ReactNode }) {
  const locale = useSyncExternalStore(subscribe, readLocale, () => DEFAULT_LOCALE);

  return (
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone={TIME_ZONE}>
      {children}
    </NextIntlClientProvider>
  );
}
