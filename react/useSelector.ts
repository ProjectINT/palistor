/**
 * useSelector - хук для выборочной подписки на часть состояния
 * 
 * Позволяет подписаться только на нужные поля, избегая лишних ре-рендеров
 */

"use client";

import { useSyncExternalStore, useCallback, useRef } from "react";
import type { Store } from "../core/types";

/**
 * Хук для подписки на выбранную часть состояния store
 * 
 * @param store - store для подписки
 * @param selector - функция выбора нужной части состояния
 * @param equalityFn - функция сравнения (по умолчанию Object.is)
 * @returns выбранная часть состояния
 * 
 * @example
 * ```tsx
 * const email = useSelector(store, state => state.values.email);
 * const { name, age } = useSelector(store, state => ({ 
 *   name: state.values.name, 
 *   age: state.values.age 
 * }), shallowEqual);
 * ```
 */
export function useSelector<T, U>(
  store: Store<T>,
  selector: (state: T) => U,
  equalityFn: (a: U, b: U) => boolean = Object.is
): U {
  // Кэшируем последнее вычисленное значение
  const lastValueRef = useRef<U | undefined>(undefined);
  const lastStateRef = useRef<T | undefined>(undefined);

  // Мемоизированный getSnapshot с проверкой равенства
  const getSnapshot = useCallback(() => {
    const state = store.getState();
    
    // Если состояние не изменилось, возвращаем кэшированное значение
    if (lastStateRef.current === state && lastValueRef.current !== undefined) {
      return lastValueRef.current;
    }

    const nextValue = selector(state);

    // Если вычисленное значение не изменилось, возвращаем кэшированное
    if (lastValueRef.current !== undefined && equalityFn(lastValueRef.current, nextValue)) {
      lastStateRef.current = state;
      return lastValueRef.current;
    }

    // Обновляем кэш
    lastStateRef.current = state;
    lastValueRef.current = nextValue;

    return nextValue;
  }, [store, selector, equalityFn]);

  return useSyncExternalStore(
    store.subscribe,
    getSnapshot,
    getSnapshot // SSR fallback
  );
}

/**
 * Shallow equality для объектов
 */
export function shallowEqual<T extends Record<string, any>>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (a === null || b === null) return false;

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!Object.is(a[key], b[key])) return false;
  }

  return true;
}
