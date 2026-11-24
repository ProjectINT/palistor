"use client";

import { useTranslations } from "next-intl";
import { useForm, usePalistor } from "@palistor";
import type { PagedResult, PalistorList, PalistorRef } from "@palistor";

import { Block, Counter } from "../shared/Block";
import { SsrShell } from "../shared/SsrShell";
import { Skeleton, Spinner, buttonClass } from "../shared/ui";
import type { Milestone, Paper, Talk, Team } from "./backend";
import { catalogConfig } from "./catalogConfig";
import { Teams } from "./Teams";

/**
 * The client side of /ssr/catalog: three paginated lists in one store, and
 * the teams block with a store of its own (Teams.tsx). Rendered on the server
 * into HTML and again in the browser during hydration, each time with a store
 * built from the same props.
 *
 * Only this component sees the store: each block gets its list as a prop and
 * hands every row down to a row component.
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
  // Only navigates: reads no state, so paging a list never re-renders the view.
  const form = useForm(store);

  return (
    <SsrShell subtitle={t("subtitle")}>
      <Block
        testId="ssr-catalog-papers"
        title={t("papers.title")}
        hint={t("papers.hint")}
        footer={<Counter event="catalog.papers" testId="ssr-catalog-papers-requests" />}
      >
        <Papers papers={form.papers} />
      </Block>

      <Block
        testId="ssr-catalog-milestones"
        title={t("milestones.title")}
        hint={t("milestones.hint")}
        footer={<Counter event="catalog.milestones" testId="ssr-catalog-milestones-requests" />}
      >
        <Milestones milestones={form.milestones} />
      </Block>

      <Block
        testId="ssr-catalog-talks"
        title={t("talks.title")}
        hint={t("talks.hint")}
        footer={<Counter event="catalog.talks" testId="ssr-catalog-talks-requests" />}
      >
        <Talks talks={form.talks} />
      </Block>

      <Block testId="ssr-catalog-teams" title={t("teams.title")} hint={t("teams.hint")}>
        <Teams teams={teams} />
      </Block>
    </SsrShell>
  );
}

// ─── (1) Pages by number, first page from the server ─────────────────────────

function Papers({ papers }: { papers: PalistorList<Paper> }) {
  const t = useTranslations("ssr.catalog");
  const list = useForm(papers);

  return (
    <div className="space-y-3">
      {/* While another page loads, the list keeps the rows it shows. */}
      <ul data-testid="ssr-catalog-papers-rows" className={`space-y-1 ${list.isFetching ? "opacity-50" : ""}`}>
        {list.map((paper, _index, id) => (
          <PaperRow key={id} paper={paper} />
        ))}
      </ul>

      <Pager testId="ssr-catalog-papers" list={papers} numbered>
        <span data-testid="ssr-catalog-papers-total">{t("papers.total", { count: list.total ?? 0 })}</span>
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

function Milestones({ milestones }: { milestones: PalistorList<Milestone> }) {
  const t = useTranslations("ssr.catalog.milestones");
  const list = useForm(milestones);

  return (
    <div className="space-y-3">
      <ol data-testid="ssr-catalog-milestones-rows" className="space-y-1">
        {list.map((milestone, _index, id) => (
          <MilestoneRow key={id} milestone={milestone} />
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
        {list.hasNextPage ? (
          <button
            data-testid="ssr-catalog-milestones-more"
            disabled={list.isFetchingNextPage}
            onClick={() => list.loadMore!()}
            className={buttonClass("neutral")}
          >
            {t("more")}
            {list.isFetchingNextPage && <Spinner testId="ssr-catalog-milestones-busy" className="ml-2" />}
          </button>
        ) : (
          <span data-testid="ssr-catalog-milestones-end">{t("end")}</span>
        )}
        <span data-testid="ssr-catalog-milestones-shown" className="ml-auto">
          {t("shown", { count: list.length, pages: list.loadedPages!.length })}
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

function Talks({ talks }: { talks: PalistorList<Talk> }) {
  const list = useForm(talks);

  // Reading `isInitialLoading` asks for the list, like `loading` does: it is
  // true in the server's HTML (the store there holds the run back) and in the
  // browser's first render, so both draw the skeleton.
  if (list.isInitialLoading) return <Skeleton testId="ssr-catalog-talks-skeleton" rows={list.pageSize} />;

  return (
    <div className="space-y-3">
      <ul data-testid="ssr-catalog-talks-rows" className={`space-y-1 ${list.isFetching ? "opacity-50" : ""}`}>
        {list.map((talk, _index, id) => (
          <TalkRow key={id} talk={talk} />
        ))}
      </ul>
      <Pager testId="ssr-catalog-talks" list={talks} />
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

// ─── Pager (blocks 1 and 3) ──────────────────────────────────────────────────

/**
 * Prev / [page numbers] / Next and "Page x of y" for the paginated list it is
 * handed. Navigation waits while a page is loading.
 */
function Pager<Row extends Paper | Talk>({
  testId,
  list: node,
  numbered = false,
  children,
}: {
  testId: string;
  list: PalistorList<Row>;
  numbered?: boolean;
  children?: React.ReactNode;
}) {
  const t = useTranslations("ssr.catalog");
  // The paging members are typed optional: present because the list declares `resolve.pagination`.
  const list = useForm(node);
  const page = list.page!;
  const pageCount = list.pageCount!;
  const busy = list.isFetching!;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
      <button
        data-testid={`${testId}-prev`}
        disabled={!list.hasPrevPage || busy}
        onClick={() => list.setPage!(page - 1)}
        className={buttonClass("neutral")}
      >
        ← {t("prev")}
      </button>
      {numbered &&
        Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            data-testid={`${testId}-page-${n}`}
            aria-current={n === page ? "page" : undefined}
            disabled={busy}
            onClick={() => list.setPage!(n)}
            className={`${buttonClass("neutral")} font-mono ${n === page ? "ring-2 ring-blue-500" : ""}`}
          >
            {n}
          </button>
        ))}
      <button
        data-testid={`${testId}-next`}
        disabled={!list.hasNextPage || busy}
        onClick={() => list.setPage!(page + 1)}
        className={buttonClass("neutral")}
      >
        {t("next")} →
      </button>
      <span data-testid={`${testId}-status`}>{t("pageOf", { page, count: pageCount })}</span>
      {busy && <Spinner testId={`${testId}-busy`} />}
      {children && <span className="ml-auto">{children}</span>}
    </div>
  );
}
