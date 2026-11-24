"use client";

import { Spinner } from "@heroui/react";
import { useForm } from "@palistor";
import type { PalistorList, PalistorProxy } from "@palistor";

import type { Product, ServerStatus, User } from "@/config/catalog/types";
import { Code } from "./Code";

/** `loading` of two lists and a group; a list also reports `resolveStatus`, a group does not. */
export function LoadingStatesSection({
  users,
  products,
  serverStatus,
}: {
  users: PalistorList<User>;
  products: PalistorList<Product>;
  serverStatus: PalistorProxy<ServerStatus>;
}) {
  const u = useForm(users);
  const p = useForm(products);
  const s = useForm(serverStatus);

  return (
    <div className="space-y-3">
      <h3 className="font-medium text-zinc-900 dark:text-zinc-100">Loading States</h3>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Every node with a resolver has <Code>loading</Code>; reading it (or the data) starts a lazy resolve.
      </p>
      <div className="grid grid-cols-3 gap-3">
        <StatusCard label="Users List" loading={u.loading} result={`${u.length} items`} status={u.resolveStatus} />
        <StatusCard label="Products List" loading={p.loading} result={`${p.length} items`} status={p.resolveStatus} />
        <StatusCard label="Server Status" loading={s.loading} result={s.status.value || "—"} />
      </div>
    </div>
  );
}

function StatusCard({ label, loading, result, status }: { label: string; loading: boolean; result: string; status?: string }) {
  return (
    <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800 space-y-1">
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <Spinner size="sm" />
          Loading...
        </div>
      ) : (
        <div className="text-sm font-medium text-green-600 dark:text-green-400">{result}</div>
      )}
      {status && <div className="font-mono text-[11px] text-zinc-400">resolveStatus: {status}</div>}
    </div>
  );
}
