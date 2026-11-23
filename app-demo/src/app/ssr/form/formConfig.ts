// The store configs of /ssr/form. No "use client" and no request data: a
// config is module-level, the stores are built per component instance by
// usePalistor (FormView.tsx, DraftBlock.tsx) with the server's data as
// `initialData`.

import { defineList } from "@palistor";
import type { ResolveErrorContext, TranslateFn } from "@palistor";
import { track } from "../shared/events";
import { fetchActivity, fetchAnnouncement, fetchProfile } from "./backend";
import type { Activity } from "./backend";

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The resolvers' `onError`: counted (the "onError calls" counter), then handed to the notifier. */
const reportTo = (what: string) => (error: unknown, { notify }: ResolveErrorContext) => {
  track("form.errors");
  // ctx.notify is the notifier of <PalistorProvider> (shared/SsrProviders.tsx), given to the store's constructor.
  notify(`Could not load ${what}: ${messageOf(error)}`);
};

/** The values a resolver of this config reads (its first argument is the whole form). */
interface SelectedUser {
  userId: string;
}

/** Blocks 1–3: the profile, the activity list and the user they both depend on. */
export const profileConfig = {
  // The user selector: a leaf outside the group, declared in both resolves' `deps`.
  userId: { value: "", label: (t: TranslateFn) => t("ssr.form.user") },

  profile: {
    resolve: {
      resolver: async (values: SelectedUser) => fetchProfile(values.userId),
      // Declared: a resolve that got initialData has not run, so nothing is auto-tracked yet.
      deps: ["userId"],
      onError: reportTo("the profile"),
    },
    name: { value: "", label: (t: TranslateFn) => t("ssr.form.profile.name") },
    email: { value: "", label: (t: TranslateFn) => t("ssr.form.profile.email") },
    role: { value: "", label: (t: TranslateFn) => t("ssr.form.profile.role") },
    bio: { value: "", label: (t: TranslateFn) => t("ssr.form.profile.bio") },
  },

  // A list has reload(), resolveStatus and error on its node; a group has neither.
  activity: defineList<Activity>({
    template: { id: { value: "" }, title: { value: "" }, date: { value: "" } },
    resolve: {
      resolver: async (values: SelectedUser) => fetchActivity(values.userId),
      deps: ["userId"],
      onError: reportTo("the activity"),
    },
  }),
};

/** Block 4: a separate store, so its draft (usePersist) cannot touch blocks 1–3. */
export const draftConfig = {
  announcement: {
    resolve: {
      // Never called on this page: the server's data answers it, and a draft does not start it.
      resolver: async () => fetchAnnouncement(),
      onError: reportTo("the announcement"),
    },
    title: { value: "", label: (t: TranslateFn) => t("ssr.form.draft.titleLabel") },
    body: { value: "", label: (t: TranslateFn) => t("ssr.form.draft.body") },
  },
};
