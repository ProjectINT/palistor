"use client";

import type { ReactNode } from "react";
import { Button } from "@heroui/react";

/** A section of the tab: a white card with its heading. */
export function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
      <h2 className={`text-xl font-semibold text-zinc-900 dark:text-zinc-100 ${subtitle ? "mb-1" : "mb-4"}`}>{title}</h2>
      {subtitle && <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">{subtitle}</p>}
      {children}
    </div>
  );
}

/** A grey note that explains what the section shows. */
export function Hint({ children }: { children: ReactNode }) {
  return (
    <div className="text-xs text-zinc-400 dark:text-zinc-500 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg px-3 py-2 space-y-0.5">
      {children}
    </div>
  );
}

/** A failed list resolve: the rows stay as they were, `reload()` runs the resolver again. */
export function ListError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm text-danger bg-danger-50 rounded-lg px-3 py-2">
      <span>{error instanceof Error ? error.message : "Could not load the list"}</span>
      <Button size="sm" variant="flat" color="danger" onPress={onRetry}>
        Retry
      </Button>
    </div>
  );
}
