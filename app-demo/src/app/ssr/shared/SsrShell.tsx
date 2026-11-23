"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { LocaleSwitcher } from "@/modules/header";

/** The routes of the SSR demo, in nav order. Each one is a `page.cube.tsx` (Cube only). */
const ROUTES = [
  { href: "/ssr", key: "lists" },
  { href: "/ssr/form", key: "form" },
  { href: "/ssr/catalog", key: "catalog" },
  { href: "/ssr/flow", key: "flow" },
  { href: "/ssr/runtime", key: "runtime" },
] as const;

/**
 * The frame of every /ssr route: the title, the route's own subtitle, the nav
 * between the routes, the locale switcher and the way back to the main demo.
 * Rendered by each route's client view, inside <SsrProviders>.
 */
export function SsrShell({
  subtitle,
  aside,
  children,
}: {
  /** What this route shows, one or two sentences. */
  subtitle: React.ReactNode;
  /** Extra items for the line under the header (next to the back link). */
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTranslations("ssr");
  const locale = useLocale();
  const pathname = usePathname();
  const current = pathname.replace(/\/+$/, "") || "/";

  // The demo is a static export: the locale lives in a cookie, read by the
  // root layout's IntlProvider after mount (providers/IntlProvider.tsx).
  const changeLocale = (next: "ru" | "en") => {
    document.cookie = `NEXT_LOCALE=${next}; path=/; max-age=31536000`;
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 py-8 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <header>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">{t("title")}</h1>
              <p className="text-zinc-600 dark:text-zinc-400 mt-1">{subtitle}</p>
            </div>
            <LocaleSwitcher locale={locale as "ru" | "en"} onLocaleChange={changeLocale} />
          </div>

          <nav data-testid="ssr-nav" className="mt-4 flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
            {ROUTES.map((route) => {
              const active = current === route.href;
              return (
                <Link
                  key={route.href}
                  href={route.href}
                  aria-current={active ? "page" : undefined}
                  className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
                    active
                      ? "border-blue-500 text-blue-600 dark:text-blue-400"
                      : "border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                  }`}
                >
                  {t(`nav.${route.key}`)}
                </Link>
              );
            })}
          </nav>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <Link href="/" className="text-blue-600 dark:text-blue-400 hover:underline">
              {t("back")}
            </Link>
            {aside}
          </div>
        </header>

        {children}
      </div>
    </div>
  );
}
