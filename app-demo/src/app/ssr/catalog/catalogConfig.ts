// The store configs of /ssr/catalog. No "use client": the Server Component
// (page.cube.tsx) imports the page sizes from here, and `defineList` from the
// package root is evaluated on the server as well as in the browser.

import { defineList } from "@palistor";
import type { ListResolveContext, TemplateConfig, TranslateFn } from "@palistor";

import { fetchMilestones, fetchPapers, fetchTalks } from "./backend";
import type { Member, Milestone, Paper, Talk, TeamRow } from "./backend";

/** The server queries its first pages with the same sizes as the store's `pagination`. */
export const PAPERS_PAGE_SIZE = 5;
export const MILESTONES_PAGE_SIZE = 4;
export const TALKS_PAGE_SIZE = 3;

export const catalogConfig = {
  // (1) Pages by number. The server sends page 1 as `{ items, total }`.
  papers: defineList<Paper>({
    template: {
      id: { value: "" },
      title: { value: "" },
      authors: { value: "" },
      year: { value: 0, label: (t: TranslateFn) => t("ssr.catalog.year") },
    },
    resolve: {
      pagination: { pageSize: PAPERS_PAGE_SIZE },
      resolver: async (_values: unknown, _store: unknown, ctx: ListResolveContext) => fetchPapers(ctx.page!),
    },
  }),

  // (2) Load more. The server sends the first page with `nextCursor` and `hasMore`.
  milestones: defineList<Milestone>({
    template: {
      id: { value: "" },
      year: { value: 0 },
      event: { value: "" },
    },
    resolve: {
      pagination: { pageSize: MILESTONES_PAGE_SIZE, mode: "infinite" },
      resolver: async (_values: unknown, _store: unknown, ctx: ListResolveContext) => fetchMilestones(ctx.page!),
    },
  }),

  // (3) Pages by number, without server data: the browser loads page 1.
  talks: defineList<Talk>({
    template: {
      id: { value: "" },
      title: { value: "" },
      speaker: { value: "" },
      year: { value: 0, label: (t: TranslateFn) => t("ssr.catalog.year") },
    },
    resolve: {
      pagination: { pageSize: TALKS_PAGE_SIZE },
      resolver: async (_values: unknown, _store: unknown, ctx: ListResolveContext) => fetchTalks(ctx.page!),
    },
  }),
};

// (4) Lists nested in rows, in a store of their own (Teams.tsx).
const members = defineList<Member>({
  template: { id: { value: "" }, name: { value: "" } },
});

export const teamsConfig = {
  // No resolver: the teams are form data the server loaded. A list resolver's
  // rows do not fill the lists nested in them (those load through their own
  // resolver), so the server's rows-with-members are not something a root
  // resolver here would return.
  teams: defineList<TeamRow>({
    // The typed template does not accept a nested list yet (TS2559): cast the template.
    template: { id: { value: "" }, name: { value: "" }, members } as unknown as TemplateConfig<TeamRow>,
  }),
};
