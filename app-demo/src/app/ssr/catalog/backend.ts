// The "backend" of /ssr/catalog. Two sides use it:
//
// - the Server Component (page.cube.tsx) runs the queries below against the
//   JSON files, as it would query a database;
// - the browser calls the fake endpoints from the store's resolvers. They run
//   the same queries over the same JSON, answer after a delay and count their
//   calls (../shared/events.ts) — nothing here touches the network.
//
// One query per list, shared by both sides: the server's first page is what
// the store's first request would return (the `initialData` rule).

import type { PagedResult, PageRequest } from "@palistor";

import { fakeRequest } from "../shared/events";
import milestoneTable from "./milestones.json";
import paperTable from "./papers.json";

export interface Paper {
  id: string;
  title: string;
  authors: string;
  year: number;
}

export interface Milestone {
  id: string;
  year: number;
  event: string;
}

export interface Talk {
  id: string;
  title: string;
  speaker: string;
  year: number;
}

export interface Member {
  id: string;
  name: string;
}

/** A team row as the list's template sees it; `members` is a list nested in the row. */
export interface TeamRow {
  id: string;
  name: string;
}

/** A team as the server reads it: the row with the rows of its nested list. */
export interface Team extends TeamRow {
  members: Member[];
}

// ─── Queries (server and browser) ────────────────────────────────────────────

/** Page-number pagination: one page by offset, with the total. */
export function queryPapers(rows: Paper[], page: { offset: number; pageSize: number }): PagedResult<Paper> {
  return { items: rows.slice(page.offset, page.offset + page.pageSize), total: rows.length };
}

/**
 * Keyset pagination: the page that starts at the row with id `cursor` (the
 * first page for `null`). `nextCursor` is the id of the row after the page;
 * `nextCursor: null` on the last page ends the feed, also when that page is
 * full (12 rows by 4 here).
 */
export function queryMilestones(rows: Milestone[], cursor: string | null, pageSize: number): PagedResult<Milestone> {
  const start = cursor === null ? 0 : Math.max(0, rows.findIndex((row) => row.id === cursor));
  const items = rows.slice(start, start + pageSize);
  const next = start + items.length;
  return { items, nextCursor: rows[next]?.id ?? null };
}

// The talks exist only in the browser: the server has no data for that list.
const TALKS: Talk[] = [
  { id: "talk-1", title: "The Mother of All Demos", speaker: "Douglas Engelbart", year: 1968 },
  { id: "talk-2", title: "The Humble Programmer", speaker: "Edsger W. Dijkstra", year: 1972 },
  { id: "talk-3", title: "Growing a Language", speaker: "Guy Steele", year: 1998 },
  { id: "talk-4", title: "Hammock Driven Development", speaker: "Rich Hickey", year: 2010 },
  { id: "talk-5", title: "Simple Made Easy", speaker: "Rich Hickey", year: 2011 },
  { id: "talk-6", title: "Inventing on Principle", speaker: "Bret Victor", year: 2012 },
  { id: "talk-7", title: "Boundaries", speaker: "Gary Bernhardt", year: 2012 },
  { id: "talk-8", title: "Wat", speaker: "Gary Bernhardt", year: 2012 },
  { id: "talk-9", title: "The Future of Programming", speaker: "Bret Victor", year: 2013 },
];

// ─── Fake endpoints (browser only) ───────────────────────────────────────────
// Counted under "catalog.papers", "catalog.milestones" and "catalog.talks".

export const fetchPapers = (page: PageRequest): Promise<PagedResult<Paper>> =>
  fakeRequest("catalog.papers", () => queryPapers(paperTable, page), 500);

export const fetchMilestones = (page: PageRequest): Promise<PagedResult<Milestone>> =>
  fakeRequest("catalog.milestones", () => queryMilestones(milestoneTable, page.cursor ?? null, page.pageSize), 500);

export const fetchTalks = (page: PageRequest): Promise<PagedResult<Talk>> =>
  fakeRequest("catalog.talks", () => ({ items: TALKS.slice(page.offset, page.offset + page.pageSize), total: TALKS.length }), 600);
