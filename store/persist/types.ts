/**
 * Persist — the abstract storage driver interface and persistence options.
 *
 * A driver can be synchronous (localStorage) or asynchronous (IndexedDB).
 * All methods return `T | Promise<T>` — the persist manager handles both
 * uniformly via `Promise.resolve()`.
 */

// ─── Driver ──────────────────────────────────────────────────────────────────

/**
 * Storage driver interface.
 *
 * Implement this interface for any backend:
 * localStorage, sessionStorage, IndexedDB, AsyncStorage, the file system, etc.
 *
 * @example
 * ```ts
 * const myDriver: PersistDriver = {
 *   getItem: (key) => localStorage.getItem(key),
 *   setItem: (key, value) => localStorage.setItem(key, value),
 *   removeItem: (key) => localStorage.removeItem(key),
 * };
 * ```
 */
export interface PersistDriver {
  /** Read a value by key. `null` when not found. */
  getItem(key: string): string | null | Promise<string | null>;

  /** Write a value by key. */
  setItem(key: string, value: string): void | Promise<void>;

  /** Remove a value by key. */
  removeItem(key: string): void | Promise<void>;
}

// ─── Options ─────────────────────────────────────────────────────────────────

/**
 * Persistence options for the ProxyStore.
 *
 * @template TValues — the form values type
 */
export interface PersistOptions<TValues = Record<string, unknown>> {
  /** Unique storage key. */
  key: string;

  /** Storage driver (localStorage, IndexedDB, …). */
  driver: PersistDriver;

  /**
   * Custom serializer (defaults to `JSON.stringify`).
   * Useful for binary formats, encryption, etc.
   */
  serialize?: (values: Partial<TValues>) => string;

  /**
   * Custom deserializer (defaults to `JSON.parse`).
   */
  deserialize?: (raw: string) => Partial<TValues>;

  /**
   * Write delay in ms (debounce). Default 100 ms.
   * Set 0 for immediate writes.
   */
  debounce?: number;

  /**
   * Persist only the listed top-level fields.
   * When set, `omit` is ignored.
   */
  pick?: (keyof TValues & string)[];

  /**
   * Exclude the listed top-level fields from persistence.
   * Ignored when `pick` is set.
   */
  omit?: (keyof TValues & string)[];
}
