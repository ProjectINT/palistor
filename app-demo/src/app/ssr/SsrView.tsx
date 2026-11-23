"use client";

import { Suspense, useSyncExternalStore } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useForm, usePalistor, usePalistorContext } from "@palistor";
import type { Palistor, PalistorRef } from "@palistor";

import { LocaleSwitcher } from "@/modules/header";
import { requestCount, subscribeRequests } from "./backend";
import type { Endpoint, Engineer, Project } from "./backend";
import { ssrConfig } from "./ssrConfig";

type SsrStore = Palistor<typeof ssrConfig>;

/**
 * The client side of the /ssr page. It renders twice: on the server into HTML
 * and in the browser during hydration, each time with a store of its own built
 * from the same props. `usePalistor` makes that store once per component
 * instance; the translator and the context come from <PalistorProvider>
 * (SsrProviders.tsx) and are in place before the first render.
 */
export function SsrView({ engineers }: { engineers: Engineer[] }) {
  const t = useTranslations("ssr");
  const locale = useLocale();
  const { workspace } = usePalistorContext<{ workspace: string }>();

  // The server's rows are the result the `engineers` resolver would have
  // returned: the list starts resolved and no request follows hydration.
  const store = usePalistor(() => ({ config: ssrConfig, initialData: { engineers } }));

  const changeLocale = (next: "ru" | "en") => {
    document.cookie = `NEXT_LOCALE=${next}; path=/; max-age=31536000`;
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <header>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">{t("title")}</h1>
              <p className="text-zinc-600 dark:text-zinc-400 mt-1">{t("subtitle")}</p>
            </div>
            <LocaleSwitcher locale={locale as "ru" | "en"} onLocaleChange={changeLocale} />
          </div>
          <div className="mt-3 flex items-center gap-4 text-sm">
            <Link href="/" className="text-blue-600 dark:text-blue-400 hover:underline">
              {t("back")}
            </Link>
            <span className="text-zinc-500 dark:text-zinc-400">
              {t("workspace")}: <span className="font-mono" data-testid="ssr-workspace">{workspace}</span>
            </span>
          </div>
        </header>

        <Block testId="ssr-engineers" endpoint="engineers" title={t("engineers.title")} hint={t("engineers.hint")}>
          <Engineers store={store} />
        </Block>

        <Block testId="ssr-projects" endpoint="projects" title={t("projects.title")} hint={t("projects.hint")}>
          <Projects store={store} />
        </Block>

        <Block testId="ssr-summary" endpoint="summary" title={t("summary.title")} hint={t("summary.hint")}>
          {/* The suspending node is read below the boundary; usePalistor is called above it. */}
          <Suspense
            fallback={
              <p data-testid="ssr-summary-fallback" className="text-sm text-zinc-500 dark:text-zinc-400">
                {t("summary.fallback")}
              </p>
            }
          >
            <Summary store={store} />
          </Suspense>
        </Block>
      </div>
    </div>
  );
}

// ─── (a) A list with data from the server ────────────────────────────────────

function Engineers({ store }: { store: SsrStore }) {
  const t = useTranslations("ssr.engineers");
  const engineers = useForm(store).engineers;
  const filter = engineers.filter!; // typed optional; present because the config declares the block
  const search = filter.search;

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          {search.label}
          {(filter.isPending || engineers.loading) && (
            <span
              data-testid="ssr-engineers-busy"
              className="ml-2 inline-block w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin align-middle"
            />
          )}
        </span>
        <input
          data-testid="ssr-engineers-search"
          value={search.value}
          onChange={(e) => search.onValueChange(e.target.value)}
          placeholder={search.placeholder}
          className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-zinc-900 dark:text-zinc-100"
        />
      </label>

      <ul data-testid="ssr-engineers-rows" className="space-y-1">
        {engineers.map((engineer, _index, id) => (
          <EngineerRow key={id} engineer={engineer} />
        ))}
      </ul>
      {engineers.length === 0 && (
        <p className="text-zinc-400 dark:text-zinc-500 text-center py-4">{t("empty")}</p>
      )}
    </div>
  );
}

function EngineerRow({ engineer }: { engineer: PalistorRef<Engineer> }) {
  const row = useForm(engineer);

  return (
    <li
      data-testid="ssr-engineer"
      className="flex justify-between items-center p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
    >
      <span className="font-medium text-zinc-900 dark:text-zinc-100">{row.name.value}</span>
      <span className="text-sm text-zinc-500 dark:text-zinc-400">
        {row.focus.label}: {row.focus.value}
      </span>
    </li>
  );
}

// ─── (b) A list without server data ──────────────────────────────────────────

function Projects({ store }: { store: SsrStore }) {
  const projects = useForm(store).projects;

  // Reading `loading` asks for the list: it is `true` in the server's HTML and
  // in the browser's first render, so both draw the skeleton.
  if (projects.loading) {
    return (
      <div data-testid="ssr-projects-skeleton" className="space-y-1">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-11 rounded-lg bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <ul data-testid="ssr-projects-rows" className="space-y-1">
      {projects.map((project, _index, id) => (
        <ProjectRow key={id} project={project} />
      ))}
    </ul>
  );
}

function ProjectRow({ project }: { project: PalistorRef<Project> }) {
  const row = useForm(project);

  return (
    <li
      data-testid="ssr-project"
      className="flex justify-between items-center p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
    >
      <span className="font-medium text-zinc-900 dark:text-zinc-100">{row.title.value}</span>
      <span className="text-sm text-zinc-500 dark:text-zinc-400">
        {row.year.label}: <span className="font-mono">{row.year.value}</span>
      </span>
    </li>
  );
}

// ─── (c) A group that suspends ───────────────────────────────────────────────

function Summary({ store }: { store: SsrStore }) {
  const summary = useForm(store).summary;

  // Without this read the fields' defaults ("0") show between the server's fallback and the data.
  void summary.loading;

  return (
    <dl data-testid="ssr-summary-content" className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="text-zinc-500 dark:text-zinc-400">{summary.workspace.label}</dt>
      <dd data-testid="ssr-summary-workspace" className="font-mono text-zinc-900 dark:text-zinc-100">
        {summary.workspace.value}
      </dd>
      <dt className="text-zinc-500 dark:text-zinc-400">{summary.headcount.label}</dt>
      <dd data-testid="ssr-summary-headcount" className="font-mono text-zinc-900 dark:text-zinc-100">
        {summary.headcount.value}
      </dd>
      <dt className="text-zinc-500 dark:text-zinc-400">{summary.topFocus.label}</dt>
      <dd data-testid="ssr-summary-top-focus" className="font-mono text-zinc-900 dark:text-zinc-100">
        {summary.topFocus.value}
      </dd>
    </dl>
  );
}

// ─── Shared pieces ───────────────────────────────────────────────────────────

function Block({
  testId,
  endpoint,
  title,
  hint,
  children,
}: {
  testId: string;
  /** The fake endpoint this block's resolver calls: its call count is shown under the block. */
  endpoint: Endpoint;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("ssr");
  const requests = useRequestCount(endpoint);

  return (
    <section
      data-testid={testId}
      className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6"
    >
      <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-1">{title}</h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">{hint}</p>
      {children}
      <p className="mt-4 text-xs text-zinc-400 dark:text-zinc-500">
        {t("requests")}:{" "}
        <span data-testid={`${testId}-requests`} className="font-mono">
          {requests}
        </span>
      </p>
    </section>
  );
}

/**
 * Calls of a fake endpoint in this tab. The server never calls one, so its
 * snapshot — also used by the render that hydrates the server's HTML — is 0.
 */
function useRequestCount(endpoint: Endpoint): number {
  return useSyncExternalStore(
    subscribeRequests,
    () => requestCount(endpoint),
    () => 0,
  );
}
