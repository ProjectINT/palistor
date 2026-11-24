"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PalistorProvider, useForm, usePalistor, usePalistorContext } from "@palistor";
import type { PalistorProxy } from "@palistor";

import { Block, Counter } from "../shared/Block";
import { track } from "../shared/events";
import { Flag, Skeleton } from "../shared/ui";
import { REGIONS, type Mirror as MirrorValues, type Region } from "./backend";
import { mirrorConfig } from "./runtimeConfig";
import { Button, Note, Row } from "./ui";

/**
 * Block 4. A nested <PalistorProvider> adds `region` to the page's context
 * (`workspace`, shared/SsrProviders.tsx). The region is component state:
 * none on the server and in the first client render.
 */
export function ContextBlock() {
  const t = useTranslations("ssr.runtime.context");
  // An object, replaced on every pick — the same region included — so a
  // repeated pick re-renders the provider with a new, equal context object.
  const [pick, setPick] = useState<{ region: Region | null }>({ region: null });

  const choose = (region: Region) => {
    track("runtime.region.picks");
    setPick({ region });
  };

  return (
    <Block
      testId="runtime-context"
      title={t("title")}
      hint={t("hint")}
      footer={
        <>
          <Counter event="runtime.mirror" testId="runtime-mirror-requests" />
          <Counter event="runtime.region.picks" testId="runtime-region-picks" label={t("picks")} />
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-sm text-zinc-600 dark:text-zinc-400">{t("region")}:</span>
        {REGIONS.map((region) => (
          <Button
            key={region}
            testId={`runtime-region-${region}`}
            pressed={pick.region === region}
            onClick={() => choose(region)}
          >
            {region}
          </Button>
        ))}
      </div>

      {/* An inline object: the provider compares it per key, not by reference. */}
      <PalistorProvider context={{ region: pick.region }}>
        <Mirror />
      </PalistorProvider>
    </Block>
  );
}

function Mirror() {
  // The provider's context, merged with the providers above: what the store below gets in its constructor.
  const context = usePalistorContext<{ workspace?: string; region?: Region | null }>();
  const store = usePalistor(() => ({ config: mirrorConfig }));
  // Only navigates: the group goes down to <MirrorStatus>, which reads it.
  const form = useForm(store);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">usePalistorContext()</span>
        <Flag name="workspace" value={String(context.workspace)} testId="runtime-context-workspace" />
        <Flag name="region" value={String(context.region)} testId="runtime-context-region" />
      </div>

      <MirrorStatus mirror={form.mirror} />
    </div>
  );
}

function MirrorStatus({ mirror }: { mirror: PalistorProxy<MirrorValues> }) {
  const t = useTranslations("ssr.runtime.context");
  const m = useForm(mirror);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Flag name="loading" value={m.loading} testId="runtime-mirror-loading" />
      </div>

      {m.loading ? (
        <Skeleton testId="runtime-mirror-skeleton" rows={1} />
      ) : m.host.value === "" ? (
        // Waiting for its contextDeps: not loading, nothing requested.
        <Note testId="runtime-mirror-waiting">{t("waiting")}</Note>
      ) : (
        <ul className="space-y-1">
          <Row testId="runtime-mirror">
            <span>
              {m.host.label}: <span data-testid="runtime-mirror-host" className="font-mono">{m.host.value}</span>
            </span>
            <span className="text-zinc-500 dark:text-zinc-400">
              {m.latency.label}: <span className="font-mono">{m.latency.value}</span>
            </span>
          </Row>
        </ul>
      )}
    </>
  );
}
