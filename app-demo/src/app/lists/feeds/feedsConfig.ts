// The store configs of /lists/feeds: one store per block (FeedsView.tsx).
//
// Two stores, not one, because persistence works per store: the feed's
// `usePersist` session saves and restores its store as a whole, skips its
// saves while any root list of that store fetches a page, and drops every page
// cache of that store when it is disabled. In a store of its own the journal
// is never saved, never restored and never blocks or loses a save of the feed:
// it always starts from the network, behind its Suspense fallback.

import { defineList } from "@palistor";
import type { ListResolveContext } from "@palistor";

import { fetchJournal, fetchPosts } from "./backend";
import type { JournalEntry, Post } from "./backend";

/** 45 posts by 9: the last page is full, so only its `nextCursor: null` says the feed has ended. */
export const FEED_PAGE_SIZE = 9;
/** At most this many pages stay on screen; loading another drops the oldest. */
export const FEED_MAX_PAGES = 3;
/** 30 entries by 6: full pages again, the last one ends with `nextCursor: null`. */
export const JOURNAL_PAGE_SIZE = 6;

/** The localStorage key of the feed's saved window. */
export const FEED_PERSIST_KEY = "palistor-demo:lists-feed";

export const feedConfig = {
  // Load more at the bottom. `nextCursor: null` from the backend ends the
  // feed; `maxPages` keeps the window at three pages; `persist: "window"`
  // saves every page of the window and the scroll anchor (the default saves a
  // bounded tail and no anchor).
  feed: defineList<Post>({
    template: {
      id: { value: "" },
      author: { value: "" },
      text: { value: "" },
      createdAt: { value: "" },
    },
    // A paginated list holds a window of pages, so the server sorts it: the
    // sort reaches the resolver as `ctx.sort` and is part of the query key. A
    // change is one request and the window starts over at the first page.
    // With the default `maxCachedQueries: 1` the other order is not kept, so
    // switching back is a request too. The sort itself is not persisted.
    sort: { $default: "-createdAt", createdAt: true },
    resolve: {
      pagination: { pageSize: FEED_PAGE_SIZE, mode: "infinite", maxPages: FEED_MAX_PAGES, persist: "window" },
      resolver: async (_values: unknown, _store: unknown, ctx: ListResolveContext) =>
        fetchPosts(ctx.page!, ctx.sort.by[0]?.dir ?? "desc"),
    },
  }),
};

export const journalConfig = {
  // Forward and back by cursor: one page on screen, every visited page cached.
  // `suspense: true`: while the list has nothing to show (its first page), a
  // read of its rows suspends to the nearest <Suspense> boundary.
  journal: defineList<JournalEntry>({
    template: {
      id: { value: "" },
      at: { value: "" },
      level: { value: "info" },
      message: { value: "" },
    },
    resolve: {
      pagination: { pageSize: JOURNAL_PAGE_SIZE, mode: "cursor" },
      resolver: async (_values: unknown, _store: unknown, ctx: ListResolveContext) => fetchJournal(ctx.page!),
      options: { suspense: true },
    },
  }),
};
