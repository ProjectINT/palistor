/**
 * PersistManager — управляет гидратацией и автосохранением состояния формы.
 *
 * Инстанцируется внутри createProxyStore.
 * Не зависит от React — может быть подключён из любого окружения.
 *
 * Жизненный цикл:
 *   1. Создаётся при createProxyStore (неактивен).
 *   2. Активируется через enable(options) — гидратация + auto-save.
 *   3. Деактивируется через disable() — отписка от store, отмена таймеров.
 */

import type { PersistDriver, PersistOptions } from "./types";
import type { AnyConfigNode } from "../collectValues";
import type { FieldState } from "../compute";
import { applyPatch } from "../applyPatch";
import { recomputeAndNotify } from "../recomputeAll";

// ─── Типы ────────────────────────────────────────────────────────────────────

/** Зависимости, которые PersistManager получает от createProxyStore. */
export interface PersistManagerDeps {
  /** Корневой узел конфига. */
  rootConfig: AnyConfigNode;
  /** WeakMap с состоянием каждого листового узла. */
  nodeState: WeakMap<object, FieldState>;
  /** Пересчитать все computed-свойства. Возвращает Set изменённых узлов. */
  recomputeAll: () => Set<object>;
  /** Уведомить подписчиков об изменённых узлах. */
  notifyChanged: (changed: Set<object>) => void;
  /** Получить текущие значения формы как вложенный объект. */
  getValues: () => Record<string, unknown>;
  /** Подписаться на любое изменение (для auto-save). Возвращает отписку. */
  subscribeGlobal: (listener: () => void) => () => void;
}

/** Публичный интерфейс PersistManager, возвращаемый createPersistManager. */
export interface PersistManager {
  /**
   * Активировать персистенцию: гидратация из storage + auto-save при изменениях.
   *
   * Если persist уже активен — предыдущий отключается.
   * Возвращает Promise, который резолвится после успешной гидратации.
   */
  enable: (options: PersistOptions) => Promise<void>;

  /** Деактивировать: отписка от store, отмена таймеров, очистка состояния. */
  disable: () => void;

  /** Принудительно сохранить текущие значения в storage (без debounce). */
  flush: () => Promise<void>;

  /** Принудительно гидратировать из storage. */
  hydrate: () => Promise<void>;

  /** Удалить данные из storage по текущему ключу. */
  clear: () => Promise<void>;

  /** Активна ли персистенция в данный момент. */
  isEnabled: () => boolean;
}

// ─── Фильтрация полей ────────────────────────────────────────────────────────

/**
 * Отфильтровать значения по pick/omit.
 * pick имеет приоритет. Если ни pick, ни omit не заданы — возвращает всё.
 */
function filterValues(
  values: Record<string, unknown>,
  pick?: string[],
  omit?: string[],
): Record<string, unknown> {
  if (pick && pick.length > 0) {
    const result: Record<string, unknown> = {};
    for (const key of pick) {
      if (key in values) result[key] = values[key];
    }
    return result;
  }

  if (omit && omit.length > 0) {
    const omitSet = new Set(omit);
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(values)) {
      if (!omitSet.has(key)) result[key] = values[key];
    }
    return result;
  }

  return values;
}

// ─── Фабрика ─────────────────────────────────────────────────────────────────

/**
 * Создать PersistManager.
 *
 * @param deps — зависимости от ProxyStore (передаются при инициализации store)
 */
export function createPersistManager(deps: PersistManagerDeps): PersistManager {
  const { rootConfig, nodeState, recomputeAll, notifyChanged, getValues, subscribeGlobal } = deps;

  // ─── Внутреннее состояние ─────────────────────────────────────────────────

  let active = false;
  let currentKey: string | null = null;
  let currentDriver: PersistDriver | null = null;
  let serialize: (v: Record<string, unknown>) => string = JSON.stringify;
  let deserialize: (raw: string) => Record<string, unknown> = JSON.parse;
  let debounceMs = 100;
  let pickFields: string[] | undefined;
  let omitFields: string[] | undefined;

  /** Отписка от subscribeGlobal. */
  let unsubscribe: (() => void) | null = null;

  /** ID таймера debounce. */
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Флаг, предотвращающий сохранение во время гидратации. */
  let isHydrating = false;

  // ─── Вспомогательные ──────────────────────────────────────────────────────

  function cancelDebounce() {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  /**
   * Сохранить текущие значения в storage (без debounce).
   */
  async function saveToStorage(): Promise<void> {
    if (!active || !currentKey || !currentDriver) return;

    const allValues = getValues();
    const filtered = filterValues(allValues, pickFields, omitFields);

    try {
      const serialized = serialize(filtered);
      await Promise.resolve(currentDriver.setItem(currentKey, serialized));
    } catch {
      // Ошибки сериализации/записи — молчим (production-safe)
    }
  }

  /**
   * Запланировать сохранение с debounce.
   */
  function scheduleSave() {
    if (!active || isHydrating) return;

    cancelDebounce();

    if (debounceMs <= 0) {
      saveToStorage();
      return;
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      saveToStorage();
    }, debounceMs);
  }

  /**
   * Прочитать из storage и применить значения к nodeState.
   */
  async function hydrateFromStorage(): Promise<void> {
    if (!currentKey || !currentDriver) return;

    isHydrating = true;

    try {
      const raw = await Promise.resolve(currentDriver.getItem(currentKey));
      if (raw === null) {
        isHydrating = false;
        return;
      }

      const values = deserialize(raw);
      if (!values || typeof values !== "object") {
        isHydrating = false;
        return;
      }

      // Применяем как патч — applyPatch рекурсивно обходит дерево конфига
      const patchedNodes = applyPatch(rootConfig, nodeState, values, new Set());

      // Пересчитываем, объединяем и уведомляем подписчиков
      recomputeAndNotify(patchedNodes, recomputeAll, notifyChanged);
    } catch {
      // Ошибки десериализации — молчим
    } finally {
      isHydrating = false;
    }
  }

  // ─── Публичный API ─────────────────────────────────────────────────────────

  function enable(options: PersistOptions): Promise<void> {
    // Если уже активен — отключаем предыдущий
    if (active) disable();

    // Сохраняем настройки
    currentKey = options.key;
    currentDriver = options.driver;
    serialize = options.serialize ?? JSON.stringify;
    deserialize = options.deserialize ?? JSON.parse;
    debounceMs = options.debounce ?? 100;
    pickFields = options.pick as string[] | undefined;
    omitFields = options.omit as string[] | undefined;
    active = true;

    // Подписка на изменения для auto-save
    unsubscribe = subscribeGlobal(scheduleSave);

    // Гидратация
    return hydrateFromStorage();
  }

  function disable() {
    active = false;
    cancelDebounce();

    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }

    currentKey = null;
    currentDriver = null;
  }

  async function flush(): Promise<void> {
    cancelDebounce();
    await saveToStorage();
  }

  async function hydrate(): Promise<void> {
    await hydrateFromStorage();
  }

  async function clear(): Promise<void> {
    if (!currentKey || !currentDriver) return;

    try {
      await Promise.resolve(currentDriver.removeItem(currentKey));
    } catch {
      // noop
    }
  }

  function isEnabled(): boolean {
    return active;
  }

  return {
    enable,
    disable,
    flush,
    hydrate,
    clear,
    isEnabled,
  };
}
