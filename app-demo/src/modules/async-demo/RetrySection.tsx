"use client";

import { Spinner } from "@heroui/react";
import { useForm } from "@palistor";
import type { PalistorProxy } from "@palistor";

import type { ServerStatus } from "@/config/catalog/types";
import { Code } from "./Code";

/** A group resolve with `options.retry`: `loading` stays true across the failed attempts. */
export function RetrySection({ serverStatus }: { serverStatus: PalistorProxy<ServerStatus> }) {
  const s = useForm(serverStatus);
  const status = s.status.value;
  const checkedAt = s.timestamp.value;

  return (
    <div className="space-y-3">
      <h3 className="font-medium text-zinc-900 dark:text-zinc-100">Retry & Error Handling</h3>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        The <Code>serverStatus</Code> resolver fails 2 out of 3 times. With{" "}
        <Code>retry: {"{ attempts: 3, delay: 1000 }"}</Code> Palistor tries again after 1s; <Code>onError</Code> runs
        only when every attempt fails.
      </p>

      <div className="p-4 rounded-lg bg-zinc-50 dark:bg-zinc-800 space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-zinc-500 dark:text-zinc-400">Status:</span>
          {s.loading ? (
            <span className="flex items-center gap-1.5 text-blue-500">
              <Spinner size="sm" />
              Waiting / retrying...
            </span>
          ) : (
            <strong className={status === "ok" ? "text-green-600 dark:text-green-400" : "text-zinc-500 dark:text-zinc-400"}>
              {status || "—"}
            </strong>
          )}
        </div>
        {checkedAt > 0 && (
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            Last check: {new Date(checkedAt).toLocaleTimeString()}
          </div>
        )}
      </div>
    </div>
  );
}
