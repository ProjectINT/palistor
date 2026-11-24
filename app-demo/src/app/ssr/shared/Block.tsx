"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";

import { eventCount, subscribeEvents } from "./events";

/** One demo block of an /ssr route: a card with a title, a hint, the content and its counters. */
export function Block({
  testId,
  title,
  hint,
  footer,
  children,
}: {
  testId: string;
  title: string;
  hint: React.ReactNode;
  /** Usually one or more <Counter>s. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      data-testid={testId}
      className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6"
    >
      <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-1">{title}</h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">{hint}</p>
      {children}
      {footer && (
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-400 dark:text-zinc-500">{footer}</div>
      )}
    </section>
  );
}

/**
 * "<label>: N" for a counter of events.ts. The label defaults to
 * "Resolver calls" (`ssr.requests`).
 */
export function Counter({ event, testId, label }: { event: string; testId: string; label?: string }) {
  const t = useTranslations("ssr");
  const count = useEventCount(event);

  return (
    <p>
      {label ?? t("requests")}:{" "}
      <span data-testid={testId} className="font-mono">
        {count}
      </span>
    </p>
  );
}

/**
 * How many times `event` was tracked in this tab. The server snapshot — also
 * used by the render that hydrates the server's HTML — is 0.
 */
function useEventCount(event: string): number {
  return useSyncExternalStore(
    subscribeEvents,
    () => eventCount(event),
    () => 0,
  );
}
