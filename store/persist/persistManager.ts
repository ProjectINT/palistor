/**
 * PersistManager — управляет гидратацией и автосохранением состояния формы.
 *
 * Инстанцируется внутри Palistor.
 * Не зависит от React — может быть подключён из любого окружения.
 *
 * Жизненный цикл:
 *   1. Создаётся при new Palistor(...) (неактивен).
 *   2. Активируется через enable(options) — гидратация + auto-save.
 *   3. Деактивируется через disable() — отписка от store, отмена таймеров.
 */

import type { PersistDriver, PersistOptions } from "./types";
import { applyPatch } from "../applyPatch/applyPatch";
import { recomputeAndNotify } from "../compute/recompute";
import type { Palistor } from "../store/palistor";

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

// ─── Класс ───────────────────────────────────────────────────────────────────

/**
 * Менеджер персистенции формы.
 *
 * Получает доступ ко всем данным формы через `kernel` (Palistor instance).
 */
export class PersistManager {
  private readonly kernel: Palistor<any>;

  // ─── Внутреннее состояние ─────────────────────────────────────────────────

  private active = false;
  private currentKey: string | null = null;
  private currentDriver: PersistDriver | null = null;
  private serialize: (v: Record<string, unknown>) => string = JSON.stringify;
  private deserialize: (raw: string) => Record<string, unknown> = JSON.parse;
  private debounceMs = 100;
  private pickFields: string[] | undefined;
  private omitFields: string[] | undefined;

  /** Отписка от subscribeGlobal. */
  private unsubscribe: (() => void) | null = null;

  /** ID таймера debounce. */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Флаг, предотвращающий сохранение во время гидратации. */
  private isHydrating = false;

  constructor(kernel: Palistor<any>) {
    this.kernel = kernel;
  }

  // ─── Вспомогательные ──────────────────────────────────────────────────────

  private cancelDebounce(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /**
   * Сохранить текущие значения в storage (без debounce).
   */
  private async saveToStorage(): Promise<void> {
    if (!this.active || !this.currentKey || !this.currentDriver) return;

    const allValues = this.kernel.getValues() as Record<string, unknown>;
    const filtered = filterValues(allValues, this.pickFields, this.omitFields);

    try {
      const serialized = this.serialize(filtered);
      await Promise.resolve(this.currentDriver.setItem(this.currentKey, serialized));
    } catch {
      // Ошибки сериализации/записи — молчим (production-safe)
    }
  }

  /**
   * Запланировать сохранение с debounce.
   */
  private scheduleSave = (): void => {
    if (!this.active || this.isHydrating) return;

    this.cancelDebounce();

    if (this.debounceMs <= 0) {
      this.saveToStorage();
      return;
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.saveToStorage();
    }, this.debounceMs);
  };

  /**
   * Прочитать из storage и применить значения к nodeState.
   */
  private async hydrateFromStorage(): Promise<void> {
    if (!this.currentKey || !this.currentDriver) return;

    this.isHydrating = true;

    try {
      const raw = await Promise.resolve(this.currentDriver.getItem(this.currentKey));
      if (raw === null) {
        this.isHydrating = false;
        return;
      }

      const values = this.deserialize(raw);
      if (!values || typeof values !== "object") {
        this.isHydrating = false;
        return;
      }

      // Применяем как патч — applyPatch рекурсивно обходит дерево конфига
      const patchedNodes = applyPatch(
        this.kernel.rootConfig,
        this.kernel.nodes.nodeState,
        values,
        new Set(),
      );

      // Пересчитываем, объединяем и уведомляем подписчиков
      recomputeAndNotify(
        patchedNodes,
        () => this.kernel.recompute(),
        (c) => this.kernel.notifyChanged(c),
      );
    } catch {
      // Ошибки десериализации — молчим
    } finally {
      this.isHydrating = false;
    }
  }

  // ─── Публичный API ─────────────────────────────────────────────────────────

  /**
   * Активировать персистенцию: гидратация из storage + auto-save при изменениях.
   *
   * Если persist уже активен — предыдущий отключается.
   * Возвращает Promise, который резолвится после успешной гидратации.
   */
  enable(options: PersistOptions): Promise<void> {
    // Если уже активен — отключаем предыдущий
    if (this.active) this.disable();

    // Сохраняем настройки
    this.currentKey = options.key;
    this.currentDriver = options.driver;
    this.serialize = options.serialize ?? JSON.stringify;
    this.deserialize = options.deserialize ?? JSON.parse;
    this.debounceMs = options.debounce ?? 100;
    this.pickFields = options.pick as string[] | undefined;
    this.omitFields = options.omit as string[] | undefined;
    this.active = true;

    // Подписка на изменения для auto-save
    this.unsubscribe = this.kernel.hub.subscribeGlobal(this.scheduleSave);

    // Гидратация
    return this.hydrateFromStorage();
  }

  /** Деактивировать: отписка от store, отмена таймеров, очистка состояния. */
  disable(): void {
    this.active = false;
    this.cancelDebounce();

    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    this.currentKey = null;
    this.currentDriver = null;
  }

  /** Принудительно сохранить текущие значения в storage (без debounce). */
  async flush(): Promise<void> {
    this.cancelDebounce();
    await this.saveToStorage();
  }

  /** Принудительно гидратировать из storage. */
  async hydrate(): Promise<void> {
    await this.hydrateFromStorage();
  }

  /** Удалить данные из storage по текущему ключу. */
  async clear(): Promise<void> {
    if (!this.currentKey || !this.currentDriver) return;

    try {
      await Promise.resolve(this.currentDriver.removeItem(this.currentKey));
    } catch {
      // noop
    }
  }

  /** Активна ли персистенция в данный момент. */
  isEnabled(): boolean {
    return this.active;
  }
}
