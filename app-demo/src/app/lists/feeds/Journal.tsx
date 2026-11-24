"use client";

import { useTranslations } from "next-intl";
import { useForm } from "@palistor";
import type { PalistorList, PalistorRef } from "@palistor";

import { Skeleton, Spinner, buttonClass } from "@/app/ssr/shared/ui";
import type { JournalEntry, JournalLevel } from "./backend";
import { JOURNAL_PAGE_SIZE } from "./feedsConfig";

const LEVEL_CLASS: Record<JournalLevel, string> = {
  info: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  warning: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  error: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
};

/**
 * The journal: a `cursor` list, one page on screen, Back / Forward. Rendered
 * under a <Suspense> boundary (FeedsView.tsx): the list has `suspense: true`.
 */
export function Journal({ journal }: { journal: PalistorList<JournalEntry> }) {
  const t = useTranslations("lists.feeds.journal");
  const list = useForm(journal);

  // The rows first. On the server this read throws, and the boundary's
  // fallback goes into the HTML; in the browser, once the store has started,
  // it suspends until the first page lands. Page changes keep the rows on
  // screen: only a list with nothing to show suspends.
  const rows = list.map((entry, _index, id) => <JournalRow key={id} entry={entry} />);
  // The browser's first render, before the store starts: a held store does
  // not suspend, the list is empty with `loading: true`. Look like the fallback.
  if (rows.length === 0 && list.loading) return <Skeleton testId="lists-journal-skeleton" rows={JOURNAL_PAGE_SIZE} />;

  // The paging members are typed optional: present because the list declares `resolve.pagination`.
  const busy = list.isFetching ?? false;

  return (
    <div className="space-y-3">
      <ol data-testid="lists-journal-rows" className={`space-y-1 ${busy ? "opacity-50" : ""}`}>
        {rows}
      </ol>

      <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
        <button
          data-testid="lists-journal-prev"
          disabled={!list.hasPrevPage || busy}
          onClick={() => list.prevPage?.()}
          className={buttonClass("neutral")}
        >
          ← {t("prev")}
        </button>
        <button
          data-testid="lists-journal-next"
          disabled={!list.hasNextPage || busy}
          onClick={() => list.nextPage?.()}
          className={buttonClass("neutral")}
        >
          {t("next")} →
        </button>
        <span data-testid="lists-journal-page">{t("page", { page: list.page ?? 1 })}</span>
        {/* Without a server total, pageCount counts the contiguous cached pages. */}
        <span data-testid="lists-journal-cached" className="ml-auto">
          {t("cached", { count: list.pageCount ?? 0 })}
        </span>
        {busy && <Spinner testId="lists-journal-busy" />}
      </div>
    </div>
  );
}

function JournalRow({ entry }: { entry: PalistorRef<JournalEntry> }) {
  const t = useTranslations("lists.feeds.journal.levels");
  const row = useForm(entry);
  const level = row.level.value;

  return (
    <li
      data-testid="lists-journal-entry"
      className="flex items-baseline gap-3 p-2 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-sm"
    >
      {/* UTC from the ISO string: the same text in every timezone. */}
      <time dateTime={row.at.value} className="font-mono text-xs text-zinc-500 dark:text-zinc-400 shrink-0">
        {row.at.value.slice(5, 16).replace("T", " ")}
      </time>
      <span className={`px-1.5 py-0.5 rounded text-xs font-medium shrink-0 ${LEVEL_CLASS[level]}`}>{t(level)}</span>
      <span data-testid="lists-journal-message" className="text-zinc-900 dark:text-zinc-100">
        {row.message.value}
      </span>
    </li>
  );
}
