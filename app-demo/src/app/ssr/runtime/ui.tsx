"use client";

import { buttonClass } from "../shared/ui";

// Small presentational pieces of the /ssr/runtime blocks (the shared ones are in ../shared/ui.tsx).

/** One sub-card inside a block: a heading, its content and (usually) a counter. */
export function Panel({ testId, title, children }: { testId: string; title: string; children: React.ReactNode }) {
  return (
    <div
      data-testid={testId}
      className="p-4 rounded-lg bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 space-y-3"
    >
      <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{title}</h3>
      {children}
    </div>
  );
}

export function Button({
  testId,
  onClick,
  pressed,
  children,
}: {
  testId: string;
  onClick: () => void;
  /** A toggle in a group: rendered as selected. */
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={pressed}
      onClick={onClick}
      className={buttonClass(pressed ? "primary" : "neutral")}
    >
      {children}
    </button>
  );
}

/** A row of a list or a group's value, as a line of text. */
export function Row({ testId, children }: { testId: string; children: React.ReactNode }) {
  return (
    <li
      data-testid={testId}
      className="flex justify-between items-center gap-3 px-3 py-2 rounded-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-800 dark:text-zinc-200"
    >
      {children}
    </li>
  );
}

/** A muted line: "nothing here yet" and the like. */
export function Note({ testId, children }: { testId?: string; children: React.ReactNode }) {
  return (
    <p data-testid={testId} className="text-sm text-zinc-500 dark:text-zinc-400">
      {children}
    </p>
  );
}
