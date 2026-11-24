// The store config of /ssr/flow: two independent flows in one store. No
// "use client": nothing here is a hook, and the module stays importable from
// a Server Component, like the overview's ssrConfig.ts.
//
// The lifecycle the page shows (evidence in cube/ssr and cube/contract):
//
// - Server mode enters no step: no onEnter / onReady, no resolver. The active
//   step's resolve is held and reads `loading: true`, unless initialData
//   answered it (cube/ssr/serverMode.test.tsx, cube/ssr/initialDataFlow.test.ts
//   "in server mode").
// - In the browser usePalistor starts the store after the first commit, and
//   start() enters each flow's active step:
//   onEnter → the step's resolve if it is idle → onReady once that run lands,
//   right away when the result came as initialData (initialDataFlow.test.ts).
// - A step's resolve result is cached: a later entry fires onEnter only
//   (cube/contract/sliceI/flowNavigation.test.ts "back to a step with a cached
//   resolve", initialDataFlow.test.ts "re-entering the step").

import { defineFlow, defineStep } from "@palistor";
import type { TranslateFn } from "@palistor";
import { track } from "../shared/events";
import { fetchProfile, fetchSlot, fetchTeam } from "./backend";

/** onEnter / onReady of a step, counted under "flow.<step>.onEnter" / ".onReady" (shared/events.ts). */
const lifecycle = (step: string) => ({
  onEnter: () => track(`flow.${step}.onEnter`),
  onReady: () => track(`flow.${step}.onReady`),
});

/**
 * A step's onSubmit gets the flow proxy as its third argument. The view's
 * "Next" calls `step.submit()`: it validates the step, shows its errors, and
 * moves on only when the step is valid.
 */
const goNext = (_values: unknown, _store: unknown, { nextStep }: { nextStep: () => void }) => nextStep();

export const flowConfig = {
  // (1) The first step's data comes from the server; the second step's from the browser.
  onboarding: defineFlow({
    steps: [
      defineStep("profile", {
        ...lifecycle("profile"),
        // Not called on this page: the server passes its result as initialData.
        resolve: { resolver: async () => fetchProfile() },
        name: {
          value: "" as string,
          isRequired: true,
          label: (t: TranslateFn) => t("ssr.flow.profile.name"),
          validate: (value: string, _values: unknown, t: TranslateFn) =>
            value.trim().length < 2 ? t("ssr.flow.profile.nameError") : undefined,
        },
        email: {
          value: "" as string,
          isRequired: true,
          label: (t: TranslateFn) => t("ssr.flow.profile.email"),
          validate: (value: string, _values: unknown, t: TranslateFn) =>
            value.includes("@") ? undefined : t("ssr.flow.profile.emailError"),
        },
        onSubmit: goNext,
      }),

      defineStep("team", {
        ...lifecycle("team"),
        // No server data: runs once, on the first entry. The context comes from
        // <PalistorProvider> (shared/SsrProviders.tsx) through the constructor.
        resolve: {
          resolver: async (_values: unknown, store: { context: Record<string, unknown> }) =>
            fetchTeam(store.context.workspace as string),
        },
        mentor: { value: "" as string, label: (t: TranslateFn) => t("ssr.flow.team.mentor") },
        channel: { value: "" as string, isReadOnly: true, label: (t: TranslateFn) => t("ssr.flow.team.channel") },
      }),
    ],
  }),

  // (2) A flow whose first step has no server data: held on the server, loaded in the browser.
  booking: defineFlow({
    steps: [
      defineStep("slot", {
        ...lifecycle("slot"),
        resolve: { resolver: async () => fetchSlot() },
        reviewer: { value: "" as string, label: (t: TranslateFn) => t("ssr.flow.slot.reviewer") },
        startsAt: { value: "" as string, label: (t: TranslateFn) => t("ssr.flow.slot.startsAt") },
        onSubmit: goNext,
      }),

      defineStep("notes", {
        topic: {
          value: "" as string,
          label: (t: TranslateFn) => t("ssr.flow.notes.topic"),
          placeholder: (t: TranslateFn) => t("ssr.flow.notes.topicPlaceholder"),
        },
      }),
    ],
  }),
};
