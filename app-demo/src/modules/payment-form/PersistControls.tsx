"use client";

import { useState } from "react";
import { Button } from "@heroui/react";

import { Section } from "@/modules/shared/Section";
import { DRAFT, DRAFT_DRIVERS, type DraftStorage } from "./constants";

interface PersistControlsProps {
  /** Where `usePersist` (in PaymentForm) keeps the draft. */
  storage: DraftStorage;
  onStorageChange: (storage: DraftStorage) => void;
  /** Writes the draft now, without waiting for the debounce: `store.persist.flush()`. */
  onSave: () => Promise<void>;
  /** Removes the saved draft: `store.persist.clear()`. */
  onClear: () => Promise<void>;
}

/** Shows what the draft holds and drives it. Reads the storage, not the form. */
export function PersistControls({ storage, onStorageChange, onSave, onClear }: PersistControlsProps) {
  // The stored snapshot, read on demand.
  const [saved, setSaved] = useState<string | null>(null);
  const other: DraftStorage = storage === "localStorage" ? "sessionStorage" : "localStorage";

  const show = async (from: DraftStorage = storage) => setSaved(await DRAFT_DRIVERS[from].getItem(DRAFT.key));

  const save = async () => {
    await onSave();
    await show();
  };

  const clear = async () => {
    await onClear();
    setSaved(null);
  };

  const switchStorage = () => {
    onStorageChange(other);
    void show(other);
  };

  return (
    <Section title="Persist Controls">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
            <span>Storage:</span>
            <span className="rounded bg-zinc-100 px-2 py-0.5 font-mono text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              {storage}
            </span>
          </div>
          <Button variant="flat" size="sm" onPress={switchStorage}>
            Switch to {other}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="flat" color="primary" size="sm" onPress={save}>
            Force Save
          </Button>
          <Button variant="flat" color="danger" size="sm" onPress={clear}>
            Clear Saved
          </Button>
          <Button variant="flat" size="sm" onPress={() => show()}>
            View Saved
          </Button>
        </div>

        <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-3 py-1.5 dark:border-zinc-700 dark:bg-zinc-800/60">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Saved data ({DRAFT.key})</span>
            <span className="text-xs text-zinc-400 dark:text-zinc-500">pick: [{DRAFT.pick.join(", ")}]</span>
          </div>
          {saved ? (
            <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all bg-white p-3 font-mono text-xs text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
              {pretty(saved)}
            </pre>
          ) : (
            <div className="p-3 text-xs italic text-zinc-400 dark:text-zinc-500">
              Nothing saved yet — click View Saved or Force Save
            </div>
          )}
        </div>

        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          💡 <code className="font-mono">usePersist</code> with <code className="font-mono">pick</code>,{" "}
          <code className="font-mono">flush()</code>, <code className="font-mono">clear()</code>, driver toggle
          localStorage ↔ sessionStorage
        </p>
      </div>
    </Section>
  );
}

function pretty(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
