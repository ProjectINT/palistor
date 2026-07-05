/**
 * Built-in storage drivers for persist.
 *
 * Each driver implements the PersistDriver interface.
 * All drivers check API availability (SSR-safe).
 */

import type { PersistDriver } from "./types";

// ─── localStorage ────────────────────────────────────────────────────────────

/**
 * Driver backed by `window.localStorage`.
 *
 * SSR-safe: no-op when `localStorage` is unavailable.
 *
 * @example
 * ```ts
 * import { localStorageDriver } from "@palistor/store/persist";
 *
 * store.setPersist({ key: "myForm", driver: localStorageDriver });
 * ```
 */
export const localStorageDriver: PersistDriver = {
  getItem(key: string): string | null {
    try {
      return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  },

  setItem(key: string, value: string): void {
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
    } catch {
      // Quota exceeded or private mode — stay silent
    }
  },

  removeItem(key: string): void {
    try {
      if (typeof localStorage !== "undefined") localStorage.removeItem(key);
    } catch {
      // noop
    }
  },
};

// ─── sessionStorage ──────────────────────────────────────────────────────────

/**
 * Driver backed by `window.sessionStorage`.
 *
 * Data survives until the tab/window is closed.
 *
 * @example
 * ```ts
 * import { sessionStorageDriver } from "@palistor/store/persist";
 *
 * store.setPersist({ key: "checkout", driver: sessionStorageDriver });
 * ```
 */
export const sessionStorageDriver: PersistDriver = {
  getItem(key: string): string | null {
    try {
      return typeof sessionStorage !== "undefined" ? sessionStorage.getItem(key) : null;
    } catch {
      return null;
    }
  },

  setItem(key: string, value: string): void {
    try {
      if (typeof sessionStorage !== "undefined") sessionStorage.setItem(key, value);
    } catch {
      // noop
    }
  },

  removeItem(key: string): void {
    try {
      if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(key);
    } catch {
      // noop
    }
  },
};
