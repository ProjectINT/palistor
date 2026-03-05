/**
 * Persist — абстрактный интерфейс драйвера хранения и опции персистенции.
 *
 * Драйвер может быть синхронным (localStorage) или асинхронным (IndexedDB).
 * Все методы возвращают `T | Promise<T>` — persist-менеджер обрабатывает оба
 * варианта единообразно через `Promise.resolve()`.
 */

// ─── Driver ──────────────────────────────────────────────────────────────────

/**
 * Интерфейс драйвера хранения.
 *
 * Реализуйте этот интерфейс для любого бэкенда:
 * localStorage, sessionStorage, IndexedDB, AsyncStorage, файловая система и т.д.
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
  /** Прочитать значение по ключу. `null` если не найдено. */
  getItem(key: string): string | null | Promise<string | null>;

  /** Записать значение по ключу. */
  setItem(key: string, value: string): void | Promise<void>;

  /** Удалить значение по ключу. */
  removeItem(key: string): void | Promise<void>;
}

// ─── Options ─────────────────────────────────────────────────────────────────

/**
 * Опции персистенции для ProxyStore.
 *
 * @template TValues — тип значений формы
 */
export interface PersistOptions<TValues = Record<string, unknown>> {
  /** Уникальный ключ хранения. */
  key: string;

  /** Драйвер хранения (localStorage, IndexedDB, …). */
  driver: PersistDriver;

  /**
   * Кастомный сериализатор (по умолчанию `JSON.stringify`).
   * Полезно для binary-форматов, шифрования и т.д.
   */
  serialize?: (values: Partial<TValues>) => string;

  /**
   * Кастомный десериализатор (по умолчанию `JSON.parse`).
   */
  deserialize?: (raw: string) => Partial<TValues>;

  /**
   * Задержка записи в ms (debounce). По умолчанию 100 ms.
   * Установите 0 для мгновенной записи.
   */
  debounce?: number;

  /**
   * Персистить только указанные поля верхнего уровня.
   * Если задано — `omit` игнорируется.
   */
  pick?: (keyof TValues & string)[];

  /**
   * Исключить указанные поля верхнего уровня из персистенции.
   * Игнорируется если задано `pick`.
   */
  omit?: (keyof TValues & string)[];
}
