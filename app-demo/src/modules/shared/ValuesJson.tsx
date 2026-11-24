"use client";

import { useCallback, useSyncExternalStore } from "react";

/** What a dump needs from a store: any Palistor store fits. */
export interface ValuesSource {
  getValues(): object;
  subscribeGlobal(listener: () => void): () => void;
}

/**
 * A store's values as pretty JSON, read again after every change.
 *
 * Not `useForm(store).values`: useForm re-renders for the state of the nodes
 * a component read, and a group's state does not include its fields' values
 * (cube/core/cube.ts, `signature`), so the dump would stop at the first edit.
 * `subscribeGlobal` fires on any change; the snapshot is a string, so React
 * compares it by value and skips renders when nothing in the values changed.
 */
function useValuesJson(store: ValuesSource): string {
  const subscribe = useCallback((onChange: () => void) => store.subscribeGlobal(onChange), [store]);
  const read = () => JSON.stringify(store.getValues(), null, 2);
  return useSyncExternalStore(subscribe, read, read);
}

/** Every value of a store, live. */
export function ValuesJson({ store }: { store: ValuesSource }) {
  const json = useValuesJson(store);

  return (
    <pre className="text-xs text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800 p-3 rounded-lg">
      {json}
    </pre>
  );
}
