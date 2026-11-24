"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useForm } from "@palistor";
import type { PalistorList, PalistorRef, SortDirection, SortKey, SortProxyNode } from "@palistor";

import { Skeleton, Spinner, buttonClass } from "@/app/ssr/shared/ui";
import type { Post } from "./backend";
import { FEED_MAX_PAGES } from "./feedsConfig";

/**
 * The feed: an `infinite` list in a scroll box. "Load more" appends a page;
 * the end of the feed replaces the button; `maxPages` drops the oldest page
 * from the window, and the page headers show which pages are on screen.
 * Newest / Oldest above the box is the list's server sort.
 *
 * The reading position is the first visible post: on scroll it goes to
 * `list.setScrollAnchor(id)`, which the saved window carries (`persist:
 * "window"`). After a reload `list.scrollAnchor` names it again, and the box
 * scrolls back to it once, when the restored rows are first on screen.
 */
export function Feed({
  feed,
  onAnchorChange,
  onClearSaved,
}: {
  feed: PalistorList<Post>;
  /** Called after a new anchor is set: `setScrollAnchor` changes no state, so nothing else would save it. */
  onAnchorChange: () => void;
  /** Removes the saved window: the next load starts from the network. */
  onClearSaved: () => void;
}) {
  const t = useTranslations("lists.feeds.feed");
  const list = useForm(feed);
  const box = useRef<HTMLDivElement>(null);
  /** The anchor last sent to the list, so a scroll within one post sends nothing. */
  const sentAnchor = useRef<string | null>(null);
  /** The first rows have been placed: the restored position is applied once. */
  const placed = useRef(false);

  // `length` starts the lazy load: read it above every early return.
  const count = list.length;
  const anchor = list.scrollAnchor ?? null;

  useEffect(() => {
    if (placed.current || count === 0) return;
    placed.current = true;
    sentAnchor.current = anchor;
    const el = box.current;
    const row = anchor && el ? el.querySelector<HTMLElement>(`[data-post-id="${anchor}"]`) : null;
    if (el && row) el.scrollTop = row.offsetTop;
  }, [count, anchor]);

  // Another order is another window, starting at its first page: so is the reading position.
  const onSortChange = () => {
    if (box.current) box.current.scrollTop = 0;
    sentAnchor.current = null;
    list.setScrollAnchor?.(null);
  };
  // The sort node is typed optional: present because the config declares the block.
  const sortBar = <FeedSort sort={list.sort!} onChange={onSortChange} />;

  // The server's HTML and the browser's first render (the store has not started
  // yet), and the moment after a sort change: no rows of the current query yet.
  if (list.isInitialLoading) {
    return (
      <div className="space-y-3">
        {sortBar}
        <Skeleton testId="lists-feed-skeleton" rows={4} label={t("loading")} />
      </div>
    );
  }

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    for (const row of el.querySelectorAll<HTMLElement>("[data-post-id]")) {
      if (row.getBoundingClientRect().bottom <= top + 1) continue;
      const id = row.dataset.postId ?? null;
      if (id !== sentAnchor.current) {
        sentAnchor.current = id;
        list.setScrollAnchor?.(id);
        onAnchorChange();
      }
      return;
    }
  };

  // The window by page: `loadedPages` lists the ordinals on screen and the ids of each.
  const pages = list.loadedPages ?? [];
  const first = pages[0]?.ordinal ?? 1;
  const last = pages[pages.length - 1]?.ordinal ?? first;
  const pageOf = new Map(pages.map((page) => [page.ids[0], page.ordinal]));

  return (
    <div className="space-y-3">
      {sortBar}
      <div
        ref={box}
        data-testid="lists-feed-scroll"
        onScroll={onScroll}
        className="relative h-96 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-700 px-3"
      >
        {list.map((post, _index, id) => (
          // The anchor element carries its page header, so restoring the first post of a page shows the header too.
          <div key={id} data-post-id={id} className="py-1.5">
            {pageOf.has(id) && (
              <p
                data-testid={`lists-feed-page-${pageOf.get(id)}`}
                className="pt-2 pb-1 text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500"
              >
                {t("page", { page: pageOf.get(id)! })}
              </p>
            )}
            <FeedPost post={post} />
          </div>
        ))}
        <div className="py-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
          {list.hasNextPage ? (
            <button
              data-testid="lists-feed-more"
              disabled={list.isFetchingNextPage}
              onClick={() => list.loadMore?.()}
              className={buttonClass("neutral")}
            >
              {t("more")}
              {list.isFetchingNextPage && <Spinner testId="lists-feed-busy" className="ml-2" />}
            </button>
          ) : (
            <span data-testid="lists-feed-end">{t("end")}</span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-500 dark:text-zinc-400">
        <span data-testid="lists-feed-shown">{t("shown", { count, pages: pages.length, first, last })}</span>
        {first > 1 && (
          <span data-testid="lists-feed-dropped" className="text-amber-700 dark:text-amber-400">
            {t("dropped", { count: first - 1, max: FEED_MAX_PAGES })}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
        <span>{t("saved")}</span>
        <button data-testid="lists-feed-clear" onClick={onClearSaved} className={buttonClass("danger")}>
          {t("clear")}
        </button>
      </div>
    </div>
  );
}

const ORDERS = [
  { dir: "desc", name: "newest" },
  { dir: "asc", name: "oldest" },
] as const satisfies ReadonlyArray<{ dir: SortDirection; name: string }>;

/** Newest / Oldest: the list's sort by `createdAt`. A change is one request for the first page of the other order. */
function FeedSort({ sort, onChange }: { sort: SortProxyNode<SortKey<Post>>; onChange: () => void }) {
  const t = useTranslations("lists.feeds.feed.sort");
  const s = useForm(sort); // re-renders when the sort changes, not when a row does
  const current = s.dirOf("createdAt");

  const choose = (dir: SortDirection) => {
    if (dir === current) return;
    s.set("createdAt", dir);
    onChange();
  };

  return (
    <div role="group" aria-label={t("label")} className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-zinc-500 dark:text-zinc-400">{t("label")}</span>
      {ORDERS.map(({ dir, name }) => (
        <button
          key={dir}
          data-testid={`lists-feed-sort-${name}`}
          aria-pressed={dir === current}
          onClick={() => choose(dir)}
          className={buttonClass(dir === current ? "primary" : "neutral")}
        >
          {t(name)}
        </button>
      ))}
    </div>
  );
}

function FeedPost({ post }: { post: PalistorRef<Post> }) {
  const row = useForm(post);

  return (
    <article
      data-testid="lists-feed-post"
      className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
    >
      <p className="flex justify-between gap-4 text-xs text-zinc-500 dark:text-zinc-400">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">{row.author.value}</span>
        {/* UTC from the ISO string: the same text in every timezone. */}
        <time dateTime={row.createdAt.value} className="font-mono">
          {row.createdAt.value.slice(0, 16).replace("T", " ")} UTC
        </time>
      </p>
      <p data-testid="lists-feed-post-text" className="mt-1 text-zinc-900 dark:text-zinc-100">
        {row.text.value}
      </p>
    </article>
  );
}
