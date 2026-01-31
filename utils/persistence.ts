/**
 * Утилиты для persistence (сохранение черновиков в localStorage)
 */

/**
 * Загружает сохранённое состояние из localStorage
 */
export function getPersistedState<T>(persistId: string): Partial<T> {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const stored = window.localStorage.getItem(persistId);
    
    if (stored) {
      return JSON.parse(stored) as Partial<T>;
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[Palistor] Failed to load persisted state:", error);
  }

  return {};
}

/**
 * Сохраняет состояние в localStorage
 */
export function setPersistedState<T>(persistId: string, state: T): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(persistId, JSON.stringify(state));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[Palistor] Failed to persist state:", error);
  }
}

/**
 * Удаляет сохранённое состояние из localStorage
 */
export function clearPersistedState(persistId: string): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(persistId);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[Palistor] Failed to clear persisted state:", error);
  }
}
