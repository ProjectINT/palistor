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

  /**
   * Called when a save or a hydration fails — both paths swallow the error to
   * stay production-safe, and without this hook a failure is invisible.
   *
   * The failure that matters in practice is a synchronous
   * `QuotaExceededError` from `setItem`: it would otherwise silently disable
   * persistence for the WHOLE form at a point determined by how far the user
   * scrolled a paginated list, so it never reproduces in dev. Before giving
   * up, the manager retries once with every pagination window trimmed to its
   * pointer, so a large list can never take the form's own persistence down.
   */
  onError?: (error: unknown, phase: "save" | "hydrate") => void;
}
