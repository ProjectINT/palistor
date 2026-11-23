"use client";

import { Suspense } from "react";
import { useTranslations } from "next-intl";
import { useForm, usePalistor, usePalistorContext } from "@palistor";
import type { Palistor, PalistorRef } from "@palistor";

import type { Engineer, Project } from "./backend";
import { Block, Counter } from "./shared/Block";
import { SsrShell } from "./shared/SsrShell";
import { ssrConfig } from "./ssrConfig";

type SsrStore = Palistor<typeof ssrConfig>;

/**
 * The client side of the /ssr page. It renders twice: on the server into HTML
 * and in the browser during hydration, each time with a store of its own built
 * from the same props. `usePalistor` makes that store once per component
 * instance; the translator and the context come from <PalistorProvider>
 * (shared/SsrProviders.tsx) and are in place before the first render.
 */
export function SsrView({ engineers }: { engineers: Engineer[] }) {
  const t = useTranslations("ssr");
  const { workspace } = usePalistorContext<{ workspace: string }>();

  // The server's rows are the result the `engineers` resolver would have
  // returned: the list starts resolved and no request follows hydration.
  const store = usePalistor(() => ({ config: ssrConfig, initialData: { engineers } }));

  return (
    <SsrShell
      subtitle={t("subtitle")}
      aside={
        <span className="text-zinc-500 dark:text-zinc-400">
          {t("workspace")}: <span className="font-mono" data-testid="ssr-workspace">{workspace}</span>
        </span>
      }
    >
      <Block
        testId="ssr-engineers"
        title={t("engineers.title")}
        hint={t("engineers.hint")}
        footer={<Counter event="engineers" testId="ssr-engineers-requests" />}
      >
        <Engineers store={store} />
      </Block>

      <Block
        testId="ssr-projects"
        title={t("projects.title")}
        hint={t("projects.hint")}
        footer={<Counter event="projects" testId="ssr-projects-requests" />}
      >
        <Projects store={store} />
      </Block>

      <Block
        testId="ssr-summary"
        title={t("summary.title")}
        hint={t("summary.hint")}
        footer={<Counter event="summary" testId="ssr-summary-requests" />}
      >
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
    </SsrShell>
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
