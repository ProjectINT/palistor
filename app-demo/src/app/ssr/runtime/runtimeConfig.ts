// The store configs of /ssr/runtime. No "use client": like the overview's
// ssrConfig.ts, a config module holds no request data and may be imported by
// a Server Component as well. Only the stores are made per component instance.

import { defineList } from "@palistor";
import type { TranslateFn } from "@palistor";
import { fetchBuilds, fetchMirror, fetchReleases, fetchTeammate } from "./backend";
import type { Build, Region, Release } from "./backend";

/**
 * Blocks 1 and 2: one lazy and one eager list, the same config for both
 * blocks. Block 1 builds its store with `server: true`, block 2 with the
 * default; each block counts the calls under its own names.
 */
function statusConfig(counter: "runtime.held" | "runtime.client", buildsDelay: number) {
  return {
    // Lazy (the default): starts on its first read.
    releases: defineList<Release>({
      template: {
        id: { value: "" },
        date: { value: "", label: (t: TranslateFn) => t("ssr.runtime.lists.date") },
      },
      resolve: {
        resolver: async () => fetchReleases(`${counter}.releases`, 600),
      },
    }),
    // Eager: starts with the store, read or not.
    builds: defineList<Build>({
      template: {
        id: { value: "" },
        target: { value: "" },
        status: { value: "", label: (t: TranslateFn) => t("ssr.runtime.lists.status") },
      },
      resolve: {
        resolver: async () => fetchBuilds(`${counter}.builds`, buildsDelay),
        options: { lazy: false },
      },
    }),
  };
}

export const heldConfig = statusConfig("runtime.held", 700);
// Slower, so the skeleton the server sent stays on screen for a moment after hydration.
export const clientConfig = statusConfig("runtime.client", 1500);

/** Block 3: one teammate card. Every card gets its own store from this config. */
export const teammateConfig = {
  teammate: {
    resolve: {
      // Loads the card's teammate by the id in the store's own context. Not
      // called on this page: every card gets its teammate as initialData.
      resolver: async (_values: unknown, store: { context: Record<string, unknown> }) =>
        fetchTeammate(store.context.teammateId as string),
    },
    name: { value: "", label: (t: TranslateFn) => t("ssr.runtime.instances.name") },
    role: { value: "", label: (t: TranslateFn) => t("ssr.runtime.instances.role") },
  },
};

/** Block 4: the nearest package mirror for the provider's region. */
export const mirrorConfig = {
  mirror: {
    resolve: {
      // Both keys come from the providers: `workspace` from the page's,
      // `region` from the block's. A run tracks the context keys it reads,
      // so a new region re-runs it.
      resolver: async (_values: unknown, store: { context: Record<string, unknown> }) =>
        fetchMirror(store.context.workspace as string, store.context.region as Region),
      // Until the region is set (non-null) the resolve waits: no run, loading: false.
      contextDeps: ["region"],
    },
    host: { value: "", label: (t: TranslateFn) => t("ssr.runtime.context.host") },
    latency: { value: 0, label: (t: TranslateFn) => t("ssr.runtime.context.latency") },
  },
};
