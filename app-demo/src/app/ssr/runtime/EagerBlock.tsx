"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useForm, usePalistor } from "@palistor";

import { Block, Counter } from "../shared/Block";
import { BuildRow, ReleaseRow, type StatusStore } from "./lists";
import { clientConfig } from "./runtimeConfig";
import { Button, Chip, Note, Panel, Skeleton } from "./ui";

/**
 * Block 2. The same lists with the default `server` option: server mode
 * during the server render (no `window`), the browser's behavior in the
 * browser, where the constructor calls `store.start()` itself.
 */
export function EagerBlock() {
  const t = useTranslations("ssr.runtime");
  const store = usePalistor(() => ({ config: clientConfig }));
  // Nothing here reads the lazy list until the button is pressed: reading its
  // `loading` would be a read too.
  const [reading, setReading] = useState(false);

  return (
    <Block testId="runtime-client" title={t("client.title")} hint={t("client.hint")}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Panel testId="runtime-client-builds" title={t("lists.eager")}>
          <Builds store={store} />
          <div className="text-xs text-zinc-400 dark:text-zinc-500">
            <Counter event="runtime.client.builds" testId="runtime-client-builds-requests" />
          </div>
        </Panel>

        <Panel testId="runtime-client-releases" title={t("lists.lazy")}>
          {reading ? (
            <Releases store={store} />
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

function Builds({ store }: { store: StatusStore }) {
  const builds = useForm(store).builds;

  // `loading`, not `resolveStatus`: the server held the resolve ("idle") while
  // the browser's constructor has already started it ("pending"); `loading` is
  // true on both sides, so the skeleton hydrates without a mismatch.
  return (
    <>
      <Chip name="loading" value={String(builds.loading)} testId="runtime-client-builds-loading" />
      {builds.loading ? (
        <Skeleton testId="runtime-client-builds-skeleton" rows={3} />
      ) : (
        <ul className="space-y-1">
          {builds.map((build, _index, id) => (
            <BuildRow key={id} build={build} testId="runtime-client-build" />
          ))}
        </ul>
      )}
    </>
  );
}

function Releases({ store }: { store: StatusStore }) {
  const releases = useForm(store).releases;

  return releases.loading ? (
    <Skeleton testId="runtime-client-releases-skeleton" />
  ) : (
    <ul className="space-y-1">
      {releases.map((release, _index, id) => (
        <ReleaseRow key={id} release={release} testId="runtime-client-release" />
      ))}
    </ul>
  );
}
