"use client";

// Small presentational pieces shared by the blocks of /ssr/runtime.

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

/** `name: value` as a monospace chip; the value carries the test id. */
export function Chip({ name, value, testId }: { name: string; value: string; testId: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 font-mono text-xs text-zinc-600 dark:text-zinc-300">
      {name}:{" "}
      <span data-testid={testId} className="font-semibold text-zinc-900 dark:text-zinc-100">
        {value}
      </span>
    </span>
  );
}

export function Skeleton({ testId, rows = 2 }: { testId: string; rows?: number }) {
  return (
    <div data-testid={testId} className="space-y-1">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-9 rounded-md bg-zinc-200 dark:bg-zinc-700 animate-pulse" />
      ))}
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
      className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
        pressed
          ? "bg-blue-600 border-blue-600 text-white"
          : "bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700"
      }`}
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
