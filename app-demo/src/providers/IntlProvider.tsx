"use client";

import { useEffect, useState } from "react";
import { NextIntlClientProvider } from "next-intl";

import en from "../../messages/en.json";
import ru from "../../messages/ru.json";

const MESSAGES = { en, ru } as const;
type Locale = keyof typeof MESSAGES;

const DEFAULT_LOCALE: Locale = "en";

function readLocale(): Locale {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const match = document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=(ru|en)/);
  return (match?.[1] as Locale | undefined) ?? DEFAULT_LOCALE;
}

/**
 * Client-side i18n provider used for the static export (GitHub Pages).
 *
 * The build has no server, so the locale can't be resolved from a cookie at
 * request time. We bundle both message sets and resolve the locale on the
 * client after mount — the first render uses DEFAULT_LOCALE so it matches the
 * prerendered HTML (no hydration mismatch), then we adopt the stored locale.
 * The LocaleSwitcher keeps working via its cookie + reload flow.
 */
export function IntlProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    setLocale(readLocale());
  }, []);

  return (
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      {children}
    </NextIntlClientProvider>
  );
}
