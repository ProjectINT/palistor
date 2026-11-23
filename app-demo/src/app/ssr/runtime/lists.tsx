"use client";

// The rows of the two lists of blocks 1 and 2. Each row is read through its
// own useForm, so it re-renders alone when its fields change.

import { useForm } from "@palistor";
import type { Palistor, PalistorRef } from "@palistor";

import type { Build, Release } from "./backend";
import type { heldConfig } from "./runtimeConfig";
import { Row } from "./ui";

/** Blocks 1 and 2 build their stores from configs of the same shape. */
export type StatusStore = Palistor<typeof heldConfig>;

export function ReleaseRow({ release, testId }: { release: PalistorRef<Release>; testId: string }) {
  const row = useForm(release);

  return (
    <Row testId={testId}>
      <span className="font-mono font-medium">{row.id}</span>
      <span className="text-zinc-500 dark:text-zinc-400">
        {row.date.label}: <span className="font-mono">{row.date.value}</span>
      </span>
    </Row>
  );
}

export function BuildRow({ build, testId }: { build: PalistorRef<Build>; testId: string }) {
  const row = useForm(build);
  const failed = row.status.value === "failed";

  return (
    <Row testId={testId}>
      <span>
        <span className="font-mono font-medium">#{row.id.replace(/^b-/, "")}</span>{" "}
        <span className="text-zinc-500 dark:text-zinc-400">{row.target.value}</span>
      </span>
      <span className={failed ? "text-red-600 dark:text-red-400" : "text-green-700 dark:text-green-400"}>
        {row.status.label}: {row.status.value}
      </span>
    </Row>
  );
}
