/**
 * useSelector - хук для выборочной подписки на часть состояния
 *
 * КАК РАБОТАЕТ ПОДПИСКА:
 * ─────────────────────────────────────────────────────────────────────────────
 * Подписка идёт на ВЕСЬ store целиком — store.subscribe уведомляет при ЛЮБОМ
 * изменении состояния (любого поля, любой вложенности). Это базовый механизм
 * pub/sub в createStore: Set<Listener> → listeners.forEach(l => l()).
 *
 * НО ре-рендер компонента происходит только тогда, когда изменилась
 * ВЫБРАННАЯ ЧАСТЬ состояния (результат selector-функции).
 * Это достигается двухуровневым кэшем внутри getSnapshot.
 *
 * СХЕМА ЖИЗНЕННОГО ЦИКЛА:
 *
 *   store.setState(...)        ← любое изменение в store
 *        │
 *        ▼
 *   listeners.forEach(l => l())  ← React зарегистрировал свой listener через store.subscribe
 *        │
 *        ▼
 *   React вызывает getSnapshot()  ← проверяет, изменился ли "снимок"
 *        │
 *        ├─ [1] state === lastStateRef?  ──► ДА → вернуть lastValueRef (нет ре-рендера)
 *        │
 *        ├─ [2] selector(state)  ──► вычислить новое значение
 *        │
 *        └─ [3] equalityFn(last, next)?  ──► ДА → вернуть lastValueRef (нет ре-рендера)
 *                                           НЕТ → обновить кэш, React перерисует компонент
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ПРИМЕРЫ:
 *
 * 1) Подписка на одно примитивное поле — Object.is достаточно (по умолчанию):
 *
 *    const email = useSelector(formStore, s => s.values.email);
 *    // Ре-рендер только при изменении email. Смена name/phone — игнорируется.
 *
 * 2) Подписка на булево значение:
 *
 *    const isSubmitting = useSelector(formStore, s => s.submitting);
 *    // Ре-рендер только при true → false или false → true.
 *
 * 3) Подписка на несколько полей сразу — нужен shallowEqual, иначе каждый
 *    вызов selector возвращает новый объект {}, и Object.is всегда false:
 *
 *    const { name, age } = useSelector(
 *      formStore,
 *      s => ({ name: s.values.name, age: s.values.age }),
 *      shallowEqual   // ← сравниваем ключи объекта, не ссылку
 *    );
 *    // Ре-рендер только если изменился name ИЛИ age.
 *    // Смена email не вызовет ре-рендер, хотя store изменился.
 *
 * 4) Подписка на вычисляемое значение:
 *
 *    const hasErrors = useSelector(formStore, s => Object.keys(s.errors).length > 0);
 *    // Ре-рендер только при переходе false ↔ true, а не при каждой смене ошибки.
 *
 * 5) Подписка на массив (нужен shallowEqual или кастомный компаратор):
 *
 *    const visibleFields = useSelector(
 *      formStore,
 *      s => s.fields.filter(f => f.visible).map(f => f.key),
 *      (a, b) => a.length === b.length && a.every((v, i) => v === b[i])
 *    );
 *
 * ВАЖНО: selector должна быть стабильной (мемоизированной или объявленной вне
 * рендера), иначе useCallback({ selector }) пересоздаст getSnapshot и
 * useSyncExternalStore переподпишется заново.
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
  // Кэшируем последнее вычисленное значение и последний объект состояния
  const lastValueRef = useRef<U | undefined>(undefined);
  const lastStateRef = useRef<T | undefined>(undefined);

  // getSnapshot вызывается React при каждом уведомлении от store.subscribe,
  // а также при каждом рендере для проверки консистентности (tear detection).
  // Возвращает стабильную ссылку если выбранная часть не изменилась —
  // именно это предотвращает ре-рендер компонента.
  const getSnapshot = useCallback(() => {
    const state = store.getState();

    // Уровень 1: если объект состояния не изменился (та же ссылка),
    // selector точно вернёт то же самое — можно пропустить вычисление.
    if (lastStateRef.current === state && lastValueRef.current !== undefined) {
      return lastValueRef.current;
    }

    const nextValue = selector(state);

    // Уровень 2: состояние изменилось, но выбранная часть — нет.
    // Возвращаем старую ссылку, чтобы useSyncExternalStore не увидел изменений
    // и не инициировал ре-рендер.
    if (lastValueRef.current !== undefined && equalityFn(lastValueRef.current, nextValue)) {
      lastStateRef.current = state;
      return lastValueRef.current;
    }

    // Выбранная часть действительно изменилась — обновляем кэш.
    // useSyncExternalStore получит новую ссылку и запланирует ре-рендер.
    lastStateRef.current = state;
    lastValueRef.current = nextValue;

    return nextValue;
  }, [store, selector, equalityFn]);

  // useSyncExternalStore — React-18 примитив для безопасной подписки на
  // внешние хранилища без "разрывов" (tearing) при concurrent рендеринге.
  // Аргументы:
  //   1. store.subscribe  — функция подписки; React вызовет её один раз при
  //                         маунте и отпишется при анмаунте через возвращённый
  //                         unsubscribe. Уведомляет React о любом изменении store.
  //   2. getSnapshot      — функция чтения "снимка"; должна возвращать
  //                         стабильную ссылку если данные не изменились.
  //   3. getSnapshot      — SSR fallback (тот же getSnapshot для серверного рендера).
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
