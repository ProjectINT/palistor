/**
 * createStore - базовый примитив для создания реактивного хранилища
 * 
 * Минималистичная реализация по образцу Zustand/Redux:
 * - getState() — получить текущее состояние
 * - setState(next) — обновить состояние (поддерживает функцию)
 * - subscribe(listener) — подписаться на изменения
 */

import type { Store, Listener } from "./types";

export function createStore<T>(initialState: T): Store<T> {
  let state = initialState;
  const listeners = new Set<Listener>();

  const getState = (): T => state;

  const setState = (next: T | ((prev: T) => T)): void => {
    const nextState = typeof next === "function" 
      ? (next as (prev: T) => T)(state) 
      : next;

    // Shallow equality check - не обновляем если тот же объект
    if (Object.is(state, nextState)) {
      return;
    }

    state = nextState;

    // Уведомляем всех подписчиков
    listeners.forEach(listener => {
      try {
        listener();
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("[Palistor] Listener error:", error);
      }
    });
  };

  const subscribe = (listener: Listener): (() => void) => {
    listeners.add(listener);

    // Возвращаем функцию отписки
    return () => {
      listeners.delete(listener);
    };
  };

  return {
    getState,
    setState,
    subscribe,
  };
}
