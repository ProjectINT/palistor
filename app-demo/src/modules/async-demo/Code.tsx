import type { ReactNode } from "react";

/** Inline code in the explanations. */
export function Code({ children }: { children: ReactNode }) {
  return <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded">{children}</code>;
}
