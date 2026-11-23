// The store config of the /ssr page. No "use client": the Server Component
// (page.cube.tsx) imports this module too, so `defineList` from the package
// root is evaluated on the server as well as in the browser.

import { defineList } from "@palistor";
import type { ListResolveContext, TranslateFn } from "@palistor";
import { fetchEngineers, fetchProjects, fetchSummary } from "./backend";
import type { Engineer, Project } from "./backend";

/**
 * The filter the store starts with. The server page queries with the same
 * values: `initialData` must be what the store's first request would return.
 */
export const INITIAL_FILTER = { search: "" };

export const ssrConfig = {
  // (a) A list the server has data for: the rows come in `initialData`.
  engineers: defineList<Engineer>({
    template: {
      id: { value: "" },
      name: { value: "" },
      focus: { value: "", label: (t: TranslateFn) => t("ssr.engineers.focus") },
    },
    filter: {
      // A server field: a change re-runs the resolver, 300 ms after the last keystroke.
      search: {
        value: INITIAL_FILTER.search,
        debounce: 300,
        label: (t: TranslateFn) => t("ssr.engineers.search"),
        placeholder: (t: TranslateFn) => t("ssr.engineers.searchPlaceholder"),
      },
    },
    resolve: {
      resolver: async (_values: unknown, _store: unknown, ctx: ListResolveContext) =>
        fetchEngineers(ctx.filter.params as { search: string }),
    },
  }),

  // (b) A list the server has no data for: it loads in the browser.
  projects: defineList<Project>({
    template: {
      id: { value: "" },
      title: { value: "" },
      year: { value: 0, label: (t: TranslateFn) => t("ssr.projects.year") },
    },
    resolve: {
      resolver: async () => fetchProjects(),
    },
  }),

  // (c) A group that suspends, also without server data.
  summary: {
    resolve: {
      // The context comes from <PalistorProvider> (shared/SsrProviders.tsx) through the constructor.
      resolver: async (_values: unknown, store: { context: Record<string, unknown> }) =>
        fetchSummary(store.context.workspace as string),
      contextDeps: ["workspace"],
      options: { suspense: true },
    },
    workspace: { value: "", label: (t: TranslateFn) => t("ssr.summary.workspace") },
    headcount: { value: 0, label: (t: TranslateFn) => t("ssr.summary.headcount") },
    topFocus: { value: "", label: (t: TranslateFn) => t("ssr.summary.topFocus") },
  },
};
