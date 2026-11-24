"use client";

import { useTranslations } from "next-intl";
import { useForm, usePalistor } from "@palistor";
import type { PalistorList } from "@palistor";

import { Block, Counter } from "../shared/Block";
import { track } from "../shared/events";
import type { Build, Release } from "./backend";
import { BuildRow, ReleaseRow } from "./lists";
import { heldConfig } from "./runtimeConfig";
import { Button, Chip, Note, Panel } from "./ui";

/**
 * Block 1. A store in server mode starts nothing by itself. A store made
 * during the server render is in that mode (no `window`); this one passes
 * `server: true`, the manual mode of `usePalistor`: the hook does not start
 * it, so the browser keeps it held too and the button plays the part of the
 * start that never comes on the server.
 */
export function ServerModeBlock() {
  const t = useTranslations("ssr.runtime");
  const store = usePalistor(() => ({ config: heldConfig, server: true }));
  // Only navigates: the panels below get their lists and read them.
  const form = useForm(store);

  const start = () => {
    track("runtime.held.start");
    store.start();
  };

  return (
    <Block
      testId="runtime-held"
      title={t("serverMode.title")}
      hint={t("serverMode.hint")}
      footer={<Counter event="runtime.held.start" testId="runtime-held-starts" label={t("serverMode.starts")} />}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Panel testId="runtime-held-releases" title={t("lists.lazyRead")}>
          <HeldReleases releases={form.releases} />
          <div className="text-xs text-zinc-400 dark:text-zinc-500">
            <Counter event="runtime.held.releases" testId="runtime-held-releases-requests" />
          </div>
        </Panel>

        <Panel testId="runtime-held-builds" title={t("lists.eager")}>
          <HeldBuilds builds={form.builds} />
          <div className="text-xs text-zinc-400 dark:text-zinc-500">
            <Counter event="runtime.held.builds" testId="runtime-held-builds-requests" />
          </div>
        </Panel>
      </div>

      <div className="mt-4">
        <Button testId="runtime-held-start" onClick={start}>
          <span className="font-mono">store.start()</span>
        </Button>
      </div>
    </Block>
  );
}

function HeldReleases({ releases }: { releases: PalistorList<Release> }) {
  const t = useTranslations("ssr.runtime");
  // Reading the lazy list wakes it; in server mode that only marks it for start().
  const list = useForm(releases);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Chip name="loading" value={String(list.loading)} testId="runtime-held-releases-loading" />
        <Chip name="resolveStatus" value={list.resolveStatus} testId="runtime-held-releases-status" />
      </div>
      {list.length === 0 ? (
        <Note>{t("lists.noRows")}</Note>
      ) : (
        <ul className="space-y-1">
          {list.map((release, _index, id) => (
            <ReleaseRow key={id} release={release} testId="runtime-held-release" />
          ))}
        </ul>
      )}
    </>
  );
}

function HeldBuilds({ builds }: { builds: PalistorList<Build> }) {
  const t = useTranslations("ssr.runtime");
  const list = useForm(builds);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Chip name="loading" value={String(list.loading)} testId="runtime-held-builds-loading" />
        <Chip name="resolveStatus" value={list.resolveStatus} testId="runtime-held-builds-status" />
      </div>
      {list.length === 0 ? (
        <Note>{t("lists.noRows")}</Note>
      ) : (
        <ul className="space-y-1">
          {list.map((build, _index, id) => (
            <BuildRow key={id} build={build} testId="runtime-held-build" />
          ))}
        </ul>
      )}
    </>
  );
}
