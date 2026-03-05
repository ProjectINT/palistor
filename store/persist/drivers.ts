/**
 * Встроенные драйверы хранения для persist.
 *
 * Каждый драйвер реализует интерфейс PersistDriver.
 * Все драйверы проверяют доступность API (SSR-совместимо).
 */

import type { PersistDriver } from "./types";

// ─── localStorage ────────────────────────────────────────────────────────────

/**
 * Драйвер на основе `window.localStorage`.
 *
 * Безопасен для SSR: при отсутствии `localStorage` — no-op.
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
      // Quota exceeded или private mode — молчим
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
 * Драйвер на основе `window.sessionStorage`.
 *
 * Данные сохраняются до закрытия вкладки/окна.
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
