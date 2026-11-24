"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { switchLocale } from "@/i18n/locale";
import { LocaleSwitcher } from "@/modules/header";

/**
 * The routes of the lists demo, in nav order. Each one is a `page.cube.tsx`
 * (Cube only) with its client view; `key` names its nav label
 * (`lists.nav.<key>`) and its message block (`lists.<key>`).
 */
export const LISTS_ROUTES = [
  { href: "/lists", key: "products" },
  { href: "/lists/orders", key: "orders" },
  { href: "/lists/customers", key: "customers" },
  { href: "/lists/feeds", key: "feeds" },
] as const;

export type ListsRoute = (typeof LISTS_ROUTES)[number]["key"];

/**
 * The frame of every /lists route: the title, the route's own subtitle, the
 * nav between the routes, the locale switcher and the way back to the main
 * demo. Rendered by each route's client view, inside <ListsProviders>; the
 * view's blocks go in as children.
 */
export function ListsShell({
  subtitle,
  aside,
  children,
}: {
  /** What this route shows, one or two sentences (`lists.<route>.subtitle`). */
  subtitle: React.ReactNode;
  /** Extra items for the line under the nav (next to the back link). */
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTranslations("lists");
  const locale = useLocale();
  const pathname = usePathname();
  const current = pathname.replace(/\/+$/, "") || "/";

  return (
    <div data-testid="lists-shell" className="min-h-screen bg-zinc-50 dark:bg-zinc-950 py-8 px-4">
      <div className="max-w-5xl mx-auto space-y-6">
        <header>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">{t("title")}</h1>
              <p data-testid="lists-subtitle" className="text-zinc-600 dark:text-zinc-400 mt-1">
                {subtitle}
              </p>
            </div>
            <LocaleSwitcher locale={locale} onLocaleChange={switchLocale} />
          </div>

          <nav data-testid="lists-nav" className="mt-4 flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
            {LISTS_ROUTES.map((route) => {
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
            <Link href="/#lists" className="text-blue-600 dark:text-blue-400 hover:underline">
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
