"use client";

import { useCatalogForm } from "@/config/catalog/catalogConfig";

export function RetrySection() {
  const form = useCatalogForm();
  const status = form.serverStatus;

  return (
    <div className="space-y-3">
      <h3 className="font-medium text-zinc-900 dark:text-zinc-100">Retry & Error Handling</h3>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        The <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded">serverStatus</code> resolver
        fails 2 out of 3 times. Palistor retries automatically up to 3 times with a 1s delay.
      </p>

      <div className="p-4 rounded-lg bg-zinc-50 dark:bg-zinc-800 space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-zinc-500 dark:text-zinc-400">Status:</span>
          {status.loading ? (
            <span className="flex items-center gap-1.5 text-blue-500">
              <span className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              Waiting / retrying...
            </span>
          ) : (
            <strong
              className={
                status.status?.value === "ok"
                  ? "text-green-600 dark:text-green-400"
                  : "text-zinc-500 dark:text-zinc-400"
              }
            >
              {status.status?.value || "—"}
            </strong>
          )}
        </div>
        {status.timestamp?.value ? (
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            Last check:{" "}
            {new Date(status.timestamp.value as number).toLocaleTimeString()}
          </div>
        ) : null}
      </div>
    </div>
  );
}
