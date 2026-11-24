// The "backend" of /lists/feeds: two keyset-paginated endpoints over the JSON
// files next to this module. They answer from memory after a delay and count
// their calls (@/app/ssr/shared/events.ts); nothing touches the network. The
// store runs no resolver on the server, so only the browser calls them.
//
// Keyset pagination: a page starts at the row whose id is the cursor (the
// first page for `null`), and `nextCursor` is the id of the row after the
// page. On the last page `nextCursor` is `null`: that is what ends the feed
// and disables "Forward" in the journal, also when the last page is full.

import type { PagedResult, PageRequest } from "@palistor";

import { fakeRequest } from "@/app/ssr/shared/events";
import journalTable from "./journal.json";
import postTable from "./posts.json";

export interface Post {
  id: string;
  author: string;
  text: string;
  /** ISO timestamp (UTC). */
  createdAt: string;
}

export type JournalLevel = "info" | "warning" | "error";

export interface JournalEntry {
  id: string;
  /** ISO timestamp (UTC). */
  at: string;
  level: JournalLevel;
  message: string;
}

/** The order of the feed: by `createdAt`, newest first (the default) or oldest first. */
export type FeedDirection = "desc" | "asc";

const POSTS: Post[] = postTable;
const JOURNAL = journalTable as JournalEntry[];

/** One page of `rows`, starting at the row with id `cursor` (`null`: the first row). */
function keysetPage<Row extends { id: string }>(rows: Row[], cursor: string | null, pageSize: number): PagedResult<Row> {
  const start = cursor === null ? 0 : rows.findIndex((row) => row.id === cursor);
  // A real API would answer 400: a cursor it never issued is not a position.
  if (start < 0) throw new Error(`Unknown cursor "${cursor}"`);
  const items = rows.slice(start, start + pageSize);
  return { items, nextCursor: rows[start + items.length]?.id ?? null };
}

/** The posts in feed order. ISO timestamps of one format compare as strings. */
export function queryPosts(direction: FeedDirection, cursor: string | null, pageSize: number): PagedResult<Post> {
  const ordered = [...POSTS].sort((a, b) =>
    direction === "desc" ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt),
  );
  return keysetPage(ordered, cursor, pageSize);
}

// ─── Fake endpoints (browser only) ───────────────────────────────────────────
// Counted under "lists.feed" and "lists.journal".

/** The feed: one page per call, in the order the list's sort asks for (`ctx.sort`, feedsConfig.ts). */
export const fetchPosts = (page: PageRequest, direction: FeedDirection = "desc"): Promise<PagedResult<Post>> =>
  fakeRequest("lists.feed", () => queryPosts(direction, page.cursor ?? null, page.pageSize), 500);

/** The journal, oldest entry first: "Forward" walks towards the latest one. */
export const fetchJournal = (page: PageRequest): Promise<PagedResult<JournalEntry>> =>
  fakeRequest("lists.journal", () => keysetPage(JOURNAL, page.cursor ?? null, page.pageSize), 800);
