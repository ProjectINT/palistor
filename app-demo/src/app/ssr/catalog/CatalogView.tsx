"use client";

import { useTranslations } from "next-intl";
import { useForm, usePalistor } from "@palistor";
import type { PagedResult, Palistor, PalistorRef } from "@palistor";

import { Block, Counter } from "../shared/Block";
import { SsrShell } from "../shared/SsrShell";
import type { Milestone, Paper, Talk, Team } from "./backend";
import { catalogConfig } from "./catalogConfig";
import { Teams } from "./Teams";

type CatalogStore = Palistor<typeof catalogConfig>;

/**
 * The client side of /ssr/catalog: three paginated lists in one store, and
 * the teams block with a store of its own (Teams.tsx). Rendered on the server
 * into HTML and again in the browser during hydration, each time with a store
 * built from the same props.
 */
export function CatalogView({
  papers,
  milestones,
  teams,
}: {
  papers: PagedResult<Paper>;
  milestones: PagedResult<Milestone>;
  teams: Team[];
}) {
  const t = useTranslations("ssr.catalog");

  // A paginated list takes its first page as the resolver returns it: it is
  // filed as a fetched page, so the list starts resolved and hydration sends
  // no request. `talks` gets no data and loads in the browser.
  const store = usePalistor(() => ({ config: catalogConfig, initialData: { papers, milestones } }));

  return (
    <SsrShell subtitle={t("subtitle")}>
      <Block
        testId="ssr-catalog-papers"
        title={t("papers.title")}
        hint={t("papers.hint")}
        footer={<Counter event="catalog.papers" testId="ssr-catalog-papers-requests" />}
      >
        <Papers store={store} />
      </Block>

      <Block
        testId="ssr-catalog-milestones"
        title={t("milestones.title")}
        hint={t("milestones.hint")}
        footer={<Counter event="catalog.milestones" testId="ssr-catalog-milestones-requests" />}
      >
        <Milestones store={store} />
      </Block>

      <Block
        testId="ssr-catalog-talks"
        title={t("talks.title")}
        hint={t("talks.hint")}
        footer={<Counter event="catalog.talks" testId="ssr-catalog-talks-requests" />}
      >
        <Talks store={store} />
      </Block>

      <Block testId="ssr-catalog-teams" title={t("teams.title")} hint={t("teams.hint")}>
        <Teams teams={teams} />
      </Block>
    </SsrShell>
  );
}

// ─── (1) Pages by number, first page from the server ─────────────────────────

function Papers({ store }: { store: CatalogStore }) {
  const t = useTranslations("ssr.catalog");
  const papers = useForm(store).papers;

  return (
    <div className="space-y-3">
      {/* While another page loads, the list keeps the rows it shows. */}
      <ul data-testid="ssr-catalog-papers-rows" className={`space-y-1 ${papers.isFetching ? "opacity-50" : ""}`}>
        {papers.map((paper, _index, id) => (
          <PaperRow key={id} paper={paper} />
        ))}
      </ul>

      <Pager
        testId="ssr-catalog-papers"
        page={papers.page!}
        pageCount={papers.pageCount!}
        hasPrev={papers.hasPrevPage!}
        hasNext={papers.hasNextPage!}
        busy={papers.isFetching!}
        onPage={(n) => papers.setPage!(n)}
        numbered
      >
        <span data-testid="ssr-catalog-papers-total">{t("papers.total", { count: papers.total ?? 0 })}</span>
      </Pager>
    </div>
  );
}

function PaperRow({ paper }: { paper: PalistorRef<Paper> }) {
  const row = useForm(paper);

  return (
    <li
      data-testid="ssr-catalog-paper"
      className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
    >
      <span className="block font-medium text-zinc-900 dark:text-zinc-100">{row.title.value}</span>
      <span className="block text-sm text-zinc-500 dark:text-zinc-400">
        {row.authors.value} · {row.year.label}: <span className="font-mono">{row.year.value}</span>
      </span>
    </li>
  );
}

// ─── (2) Load more, first page from the server ───────────────────────────────

function Milestones({ store }: { store: CatalogStore }) {
  const t = useTranslations("ssr.catalog.milestones");
  const milestones = useForm(store).milestones;

  return (
    <div className="space-y-3">
      <ol data-testid="ssr-catalog-milestones-rows" className="space-y-1">
        {milestones.map((milestone, _index, id) => (
          <MilestoneRow key={id} milestone={milestone} />
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
        {milestones.hasNextPage ? (
          <button
            data-testid="ssr-catalog-milestones-more"
            disabled={milestones.isFetchingNextPage}
            onClick={() => milestones.loadMore!()}
            className={BUTTON}
          >
            {t("more")}
            {milestones.isFetchingNextPage && <Spinner testId="ssr-catalog-milestones-busy" />}
          </button>
        ) : (
          <span data-testid="ssr-catalog-milestones-end">{t("end")}</span>
        )}
        <span data-testid="ssr-catalog-milestones-shown" className="ml-auto">
          {t("shown", { count: milestones.length, pages: milestones.loadedPages!.length })}
        </span>
      </div>
    </div>
  );
}

function MilestoneRow({ milestone }: { milestone: PalistorRef<Milestone> }) {
  const row = useForm(milestone);

  return (
    <li
      data-testid="ssr-catalog-milestone"
      className="flex gap-4 items-baseline p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
    >
      <span className="font-mono text-sm text-zinc-500 dark:text-zinc-400">{row.year.value}</span>
      <span className="text-zinc-900 dark:text-zinc-100">{row.event.value}</span>
    </li>
  );
}

// ─── (3) Pages by number, no server data ─────────────────────────────────────

function Talks({ store }: { store: CatalogStore }) {
  const talks = useForm(store).talks;

  // Reading `isInitialLoading` asks for the list, like `loading` does: it is
  // true in the server's HTML (the store there holds the run back) and in the
  // browser's first render, so both draw the skeleton.
  if (talks.isInitialLoading) {
    return (
      <div data-testid="ssr-catalog-talks-skeleton" className="space-y-1">
        {Array.from({ length: talks.pageSize! }, (_, i) => (
          <div key={i} className="h-11 rounded-lg bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ul data-testid="ssr-catalog-talks-rows" className={`space-y-1 ${talks.isFetching ? "opacity-50" : ""}`}>
        {talks.map((talk, _index, id) => (
          <TalkRow key={id} talk={talk} />
        ))}
      </ul>
      <Pager
        testId="ssr-catalog-talks"
        page={talks.page!}
        pageCount={talks.pageCount!}
        hasPrev={talks.hasPrevPage!}
        hasNext={talks.hasNextPage!}
        busy={talks.isFetching!}
        onPage={(n) => talks.setPage!(n)}
      />
    </div>
  );
}

function TalkRow({ talk }: { talk: PalistorRef<Talk> }) {
  const row = useForm(talk);

  return (
    <li
      data-testid="ssr-catalog-talk"
      className="flex justify-between items-center gap-4 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
    >
      <span className="font-medium text-zinc-900 dark:text-zinc-100">{row.title.value}</span>
      <span className="text-sm text-zinc-500 dark:text-zinc-400 text-right">
        {row.speaker.value} · {row.year.label}: <span className="font-mono">{row.year.value}</span>
      </span>
    </li>
  );
}

// ─── Shared bits ─────────────────────────────────────────────────────────────

const BUTTON =
  "px-3 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors";

/** Prev / [page numbers] / Next and "Page x of y". Navigation waits while a page is loading. */
function Pager({
  testId,
  page,
  pageCount,
  hasPrev,
  hasNext,
  busy,
  onPage,
  numbered = false,
  children,
}: {
  testId: string;
  page: number;
  pageCount: number;
  hasPrev: boolean;
  hasNext: boolean;
  busy: boolean;
  onPage: (page: number) => void;
  numbered?: boolean;
  children?: React.ReactNode;
}) {
  const t = useTranslations("ssr.catalog");

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
      <button data-testid={`${testId}-prev`} disabled={!hasPrev || busy} onClick={() => onPage(page - 1)} className={BUTTON}>
        ← {t("prev")}
      </button>
      {numbered &&
        Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            data-testid={`${testId}-page-${n}`}
            aria-current={n === page ? "page" : undefined}
            disabled={busy}
            onClick={() => onPage(n)}
            className={`${BUTTON} font-mono ${n === page ? "ring-2 ring-blue-500" : ""}`}
          >
            {n}
          </button>
        ))}
      <button data-testid={`${testId}-next`} disabled={!hasNext || busy} onClick={() => onPage(page + 1)} className={BUTTON}>
        {t("next")} →
      </button>
      <span data-testid={`${testId}-status`}>{t("pageOf", { page, count: pageCount })}</span>
      {busy && <Spinner testId={`${testId}-busy`} />}
      {children && <span className="ml-auto">{children}</span>}
    </div>
  );
}

function Spinner({ testId }: { testId: string }) {
  return (
    <span
      data-testid={testId}
      className="ml-2 inline-block w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin align-middle"
    />
  );
}
