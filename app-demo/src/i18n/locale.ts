import en from "../../messages/en.json";
import ru from "../../messages/ru.json";

export const MESSAGES = { en, ru };

export type Locale = keyof typeof MESSAGES;

export const DEFAULT_LOCALE: Locale = "en";

/** Fixed, so the prerendered HTML and the browser format dates alike (next-intl warns without one). */
export const TIME_ZONE = "UTC";

declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
  }
}

const COOKIE = "NEXT_LOCALE";

function isLocale(value: string | undefined): value is Locale {
  return value !== undefined && Object.hasOwn(MESSAGES, value);
}

/** The locale saved by `switchLocale`; the default one on the server or when nothing is saved. */
export function readLocale(): Locale {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const saved = document.cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`))?.[1];
  return isLocale(saved) ? saved : DEFAULT_LOCALE;
}

/**
 * The demo is a static export (GitHub Pages): no server reads the cookie, so
 * the page reloads and IntlProvider picks the locale up on the client.
 */
export function switchLocale(locale: Locale): void {
  document.cookie = `${COOKIE}=${locale}; path=/; max-age=31536000`;
  window.location.reload();
}
