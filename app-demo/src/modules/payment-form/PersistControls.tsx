"use client";

import { useEffect, useState } from "react";
import { usePersist } from "@palistor/react/usePersist";
import { localStorageDriver, sessionStorageDriver } from "@palistor/store/persist";
import { paymentStore } from "@/config/appConfig";
import { Button } from "@/components/Button";
import { Section } from "@/modules/shared/Section";

const PERSIST_KEY = "payment-form-demo";
const PERSIST_PICK = ["email", "phone", "name"] as const;

export function PersistControls() {
  const [storageType, setStorageType] = useState<"local" | "session">("local");
  const driver = storageType === "local" ? localStorageDriver : sessionStorageDriver;

  // usePersist with pick and toggleable driver
  usePersist(paymentStore, {
    key: PERSIST_KEY,
    driver,
    pick: [...PERSIST_PICK],
    debounce: 300,
  });

  const [savedPreview, setSavedPreview] = useState<string | null>(null);

  // Read what's currently saved in storage
  const readSaved = () => {
    if (typeof window === "undefined") return;
    const storage = storageType === "local" ? localStorage : sessionStorage;
    setSavedPreview(storage.getItem(PERSIST_KEY));
  };

  // Update preview when storage type changes
  useEffect(() => {
    readSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageType]);

  const handleFlush = async () => {
    await paymentStore.persist.flush();
    readSaved();
  };

  const handleClear = async () => {
    await paymentStore.persist.clear();
    setSavedPreview(null);
  };

  const handleToggleDriver = () => {
    setStorageType((prev) => (prev === "local" ? "session" : "local"));
  };

  const previewFormatted = (() => {
    if (!savedPreview) return null;
    try {
      return JSON.stringify(JSON.parse(savedPreview), null, 2);
    } catch {
      return savedPreview;
    }
  })();

  return (
    <Section title="Persist Controls">
      <div className="space-y-4">
        {/* Driver toggle + info */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
            <span>Storage:</span>
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
              {storageType === "local" ? "localStorage" : "sessionStorage"}
            </span>
          </div>
          <Button variant="flat" size="sm" onPress={handleToggleDriver}>
            Switch to {storageType === "local" ? "sessionStorage" : "localStorage"}
          </Button>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          <Button variant="flat" color="primary" size="sm" onPress={handleFlush}>
            Force Save
          </Button>
          <Button variant="flat" color="danger" size="sm" onPress={handleClear}>
            Clear Saved
          </Button>
          <Button variant="flat" size="sm" onPress={readSaved}>
            View Saved
          </Button>
        </div>

        {/* Saved data preview */}
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          <div className="px-3 py-1.5 bg-zinc-50 dark:bg-zinc-800/60 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Saved data ({PERSIST_KEY})
            </span>
            <span className="text-xs text-zinc-400 dark:text-zinc-500">
              pick: [email, phone, name]
            </span>
          </div>
          {previewFormatted ? (
            <pre className="p-3 text-xs font-mono text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-900 overflow-auto max-h-36 whitespace-pre-wrap break-all">
              {previewFormatted}
            </pre>
          ) : (
            <div className="p-3 text-xs text-zinc-400 dark:text-zinc-500 italic">
              Nothing saved yet — click View Saved or Force Save
            </div>
          )}
        </div>

        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          💡 <code className="font-mono">usePersist</code> with <code className="font-mono">pick</code>,{" "}
          <code className="font-mono">flush()</code>, <code className="font-mono">clear()</code>,{" "}
          driver toggle localStorage ↔ sessionStorage
        </p>
      </div>
    </Section>
  );
}
