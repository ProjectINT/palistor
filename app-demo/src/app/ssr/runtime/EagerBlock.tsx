"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useForm, usePalistor } from "@palistor";
import type { PalistorList } from "@palistor";

import { Block, Counter } from "../shared/Block";
import type { Build, Release } from "./backend";
import { BuildRow, ReleaseRow } from "./lists";
import { clientConfig } from "./runtimeConfig";
import { Button, Chip, Note, Panel, Skeleton } from "./ui";

/**
 * Block 2. The same lists with the default `server` option: server mode
 * during the server render (no `window`); in the browser `usePalistor` builds
 * the store held and calls `store.start()` in an effect after the first commit.
 */
export function EagerBlock() {
  const t = useTranslations("ssr.runtime");
  const store = usePalistor(() => ({ config: clientConfig }));
  // Only navigates: handing a list down is no read of it, so the lazy list
  // stays unread until <Releases> mounts — reading its `loading` would be a read too.
  const form = useForm(store);
  const [reading, setReading] = useState(false);

  return (
    <Block testId="runtime-client" title={t("client.title")} hint={t("client.hint")}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Panel testId="runtime-client-builds" title={t("lists.eager")}>
          <Builds builds={form.builds} />
          <div className="text-xs text-zinc-400 dark:text-zinc-500">
            <Counter event="runtime.client.builds" testId="runtime-client-builds-requests" />
          </div>
        </Panel>

        <Panel testId="runtime-client-releases" title={t("lists.lazy")}>
          {reading ? (
            <Releases releases={form.releases} />
          ) : (
            <>
              <Note testId="runtime-client-releases-unread">{t("client.unread")}</Note>
              <Button testId="runtime-client-read" onClick={() => setReading(true)}>
                {t("client.read")}
              </Button>
            </>
          )}
          <div className="text-xs text-zinc-400 dark:text-zinc-500">
            <Counter event="runtime.client.releases" testId="runtime-client-releases-requests" />
          </div>
        </Panel>
      </div>
    </Block>
  );
}

function Builds({ builds }: { builds: PalistorList<Build> }) {
  const list = useForm(builds);

  // The hydrating render reads what the server's did: the resolve is held on
  // both sides (`loading: true`, `resolveStatus: "idle"`), so the skeleton
  // hydrates without a mismatch. The hook's effect then starts the run.
  return (
    <>
      <Chip name="loading" value={String(list.loading)} testId="runtime-client-builds-loading" />
      {list.loading ? (
        <Skeleton testId="runtime-client-builds-skeleton" rows={3} />
      ) : (
        <ul className="space-y-1">
          {list.map((build, _index, id) => (
            <BuildRow key={id} build={build} testId="runtime-client-build" />
          ))}
        </ul>
      )}
    </>
  );
}

function Releases({ releases }: { releases: PalistorList<Release> }) {
  const list = useForm(releases);

  return list.loading ? (
    <Skeleton testId="runtime-client-releases-skeleton" />
  ) : (
    <ul className="space-y-1">
      {list.map((release, _index, id) => (
        <ReleaseRow key={id} release={release} testId="runtime-client-release" />
      ))}
    </ul>
  );
}
