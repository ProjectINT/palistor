"use client";

import { useEffect } from "react";
import type { NotifyFn } from "../core";

/**
 * Registers a notification function with a store (store.setNotifier on mount
 * and whenever `notifier` changes, setNotifier(null) on unmount). Resolver
 * `onError` callbacks reach it as `ctx.notify`, so config code can raise
 * toasts without importing React. With no notifier, `ctx.notify` is a no-op.
 */
export function useNotifier(store: { setNotifier(fn: NotifyFn | null): void }, notifier: NotifyFn): void {
  useEffect(() => {
    store.setNotifier(notifier);
    return () => {
      store.setNotifier(null);
    };
  }, [store, notifier]);
}
