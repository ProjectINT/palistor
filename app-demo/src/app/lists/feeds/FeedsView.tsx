"use client";

import { Suspense } from "react";
import { useTranslations } from "next-intl";
import { localStorageDriver, useForm, usePalistor, usePersist } from "@palistor";

import { Block, Counter } from "@/app/ssr/shared/Block";
import { Skeleton } from "@/app/ssr/shared/ui";

import { ListsShell } from "../shared/ListsShell";
import { Feed } from "./Feed";
import { FEED_MAX_PAGES, FEED_PERSIST_KEY, JOURNAL_PAGE_SIZE, feedConfig, journalConfig } from "./feedsConfig";
import { Journal } from "./Journal";

/**
 * The client side of /lists/feeds: an infinite feed (load more, maxPages, a
 * saved window) and a journal in cursor mode under Suspense.
 *
 * The root of the view and the only component that sees the stores: one per
 * block, so that the feed's persistence never touches the journal (see
 * feedsConfig.ts). Each block gets its list as a prop. No server data: the
 * server's HTML has the feed's skeleton and the journal's fallback, and the
 * browser loads both once the stores start, after the first commit.
 */
export function FeedsView() {
  const t = useTranslations("lists.feeds");

  const feedStore = usePalistor(() => ({ config: feedConfig }));
  // Saves the feed's window (and its scroll anchor) after every change; on
  // mount it lays the saved window over the store, served as if fetched.
  usePersist(feedStore, { key: FEED_PERSIST_KEY, driver: localStorageDriver });
  const journalStore = usePalistor(() => ({ config: journalConfig }));

  // Only navigate: they read no state, so a page change never re-renders the view.
  const feed = useForm(feedStore);
  const journal = useForm(journalStore);

  return (
    <ListsShell subtitle={t("subtitle")}>
      <Block
        testId="lists-feed"
        title={t("feed.title")}
        hint={t("feed.hint", { max: FEED_MAX_PAGES })}
        footer={<Counter event="lists.feed" testId="lists-feed-requests" />}
      >
        <Feed
          feed={feed.feed}
          onAnchorChange={() => void feedStore.persist.flush()}
          onClearSaved={() => void feedStore.persist.clear()}
        />
      </Block>

      <Block
        testId="lists-journal"
        title={t("journal.title")}
        hint={t("journal.hint")}
        footer={<Counter event="lists.journal" testId="lists-journal-requests" />}
      >
        <Suspense
          fallback={<Skeleton testId="lists-journal-fallback" rows={JOURNAL_PAGE_SIZE} label={t("journal.loading")} />}
        >
          <Journal journal={journal.journal} />
        </Suspense>
      </Block>
    </ListsShell>
  );
}
