"use client";

import { Suspense } from "react";
import { useTranslations } from "next-intl";
import { useForm, usePalistor, usePalistorContext } from "@palistor";
import type { FieldProxyNode, PalistorList, PalistorProxy, PalistorRef } from "@palistor";

import type { Engineer, Project, Summary as SummaryValues } from "./backend";
import { Block, Counter } from "./shared/Block";
import { SsrShell } from "./shared/SsrShell";
import { INPUT_CLASS, LABEL_CLASS, Skeleton, Spinner } from "./shared/ui";
import { ssrConfig } from "./ssrConfig";

/**
 * The client side of the /ssr page. It renders twice: on the server into HTML
 * and in the browser during hydration, each time with a store of its own built
 * from the same props. `usePalistor` makes that store once per component
 * instance; the translator and the context come from <PalistorProvider>
 * (shared/SsrProviders.tsx) and are in place before the first render.
 *
 * This component is the only one that sees the store: it hands each block
 * its node as a prop (a list, a group), and each block calls useForm on that
 * node and hands its own children their nodes — a row, a single field. No
 * component below knows the store or the config.
 */
export function SsrView({ engineers }: { engineers: Engineer[] }) {
  const t = useTranslations("ssr");
  const { workspace } = usePalistorContext<{ workspace: string }>();

  // The server's rows are the result the `engineers` resolver would have
  // returned: the list starts resolved and no request follows hydration.
  const store = usePalistor(() => ({ config: ssrConfig, initialData: { engineers } }));
  // Only navigates: reads no state, so it never re-renders when a block below changes.
  const form = useForm(store);

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
        <Engineers engineers={form.engineers} />
      </Block>

      <Block
        testId="ssr-projects"
        title={t("projects.title")}
        hint={t("projects.hint")}
        footer={<Counter event="projects" testId="ssr-projects-requests" />}
      >
        <Projects projects={form.projects} />
      </Block>

      <Block
        testId="ssr-summary"
        title={t("summary.title")}
        hint={t("summary.hint")}
        footer={<Counter event="summary" testId="ssr-summary-requests" />}
      >
        {/* The suspending group is read below the boundary. Handing it down is no read: `form.summary` starts nothing. */}
        <Suspense
          fallback={
            <p data-testid="ssr-summary-fallback" className="text-sm text-zinc-500 dark:text-zinc-400">
              {t("summary.fallback")}
            </p>
          }
        >
          <Summary summary={form.summary} />
        </Suspense>
      </Block>
    </SsrShell>
  );
}

// ─── (a) A list with data from the server ────────────────────────────────────

function Engineers({ engineers }: { engineers: PalistorList<Engineer> }) {
  const t = useTranslations("ssr.engineers");
  const list = useForm(engineers);
  const filter = list.filter!; // typed optional; present because the config declares the block

  return (
    <div className="space-y-3">
      <SearchField field={filter.search} busy={filter.isPending || list.loading} />

      <ul data-testid="ssr-engineers-rows" className="space-y-1">
        {list.map((engineer, _index, id) => (
          <EngineerRow key={id} engineer={engineer} />
        ))}
      </ul>
      {list.length === 0 && (
        <p className="text-zinc-400 dark:text-zinc-500 text-center py-4">{t("empty")}</p>
      )}
    </div>
  );
}

/** One filter field, handed down by the list: a component of its own, with its own useForm. */
function SearchField({ field, busy }: { field: FieldProxyNode<string>; busy: boolean }) {
  const search = useForm(field);

  return (
    <label className="block">
      <span className={LABEL_CLASS}>
        {search.label}
        {busy && <Spinner testId="ssr-engineers-busy" className="ml-2" />}
      </span>
      <input
        data-testid="ssr-engineers-search"
        value={search.value}
        onChange={(e) => search.onValueChange(e.target.value)}
        placeholder={search.placeholder}
        className={INPUT_CLASS}
      />
    </label>
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

function Projects({ projects }: { projects: PalistorList<Project> }) {
  const list = useForm(projects);

  // Reading `loading` asks for the list: it is `true` in the server's HTML and
  // in the browser's first render, so both draw the skeleton.
  if (list.loading) return <Skeleton testId="ssr-projects-skeleton" rows={3} />;

  return (
    <ul data-testid="ssr-projects-rows" className="space-y-1">
      {list.map((project, _index, id) => (
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

function Summary({ summary }: { summary: PalistorProxy<SummaryValues> }) {
  const s = useForm(summary);

  // Without this read the fields' defaults ("0") show between the server's fallback and the data.
  void s.loading;

  return (
    <dl data-testid="ssr-summary-content" className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="text-zinc-500 dark:text-zinc-400">{s.workspace.label}</dt>
      <dd data-testid="ssr-summary-workspace" className="font-mono text-zinc-900 dark:text-zinc-100">
        {s.workspace.value}
      </dd>
      <dt className="text-zinc-500 dark:text-zinc-400">{s.headcount.label}</dt>
      <dd data-testid="ssr-summary-headcount" className="font-mono text-zinc-900 dark:text-zinc-100">
        {s.headcount.value}
      </dd>
      <dt className="text-zinc-500 dark:text-zinc-400">{s.topFocus.label}</dt>
      <dd data-testid="ssr-summary-top-focus" className="font-mono text-zinc-900 dark:text-zinc-100">
        {s.topFocus.value}
      </dd>
    </dl>
  );
}
