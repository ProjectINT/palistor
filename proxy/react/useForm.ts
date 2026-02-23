/**
 * useForm — React хук для подключения к ProxyStore
 *
 * Возвращает реактивный Proxy. Доступ к полям через точку.
 * При изменении данных в хранилище компонент автоматически перерендерится.
 *
 * @example
 * ```tsx
 * // Вне React — создать хранилище один раз
 * const store = createProxyStore({ config });
 *
 * // В React — передать store
 * function App() {
 *   const user = useForm(store);
 *
 *   return (
 *     <div>
 *       <PassportSection passport={user.passport} />
 *       <input
 *         value={user.email.value}
 *         onChange={(e) => { user.email.value = e.target.value }}
 *       />
 *     </div>
 *   );
 * }
 *
 * function PassportSection({ passport }) {
 *   return (
 *     <div>
 *       <span>{passport.number.value}</span>
 *       <span>{passport.number.label}</span>
 *     </div>
 *   );
 * }
 * ```
 */

import { useSyncExternalStore, useCallback } from "react";
import type { ProxyStore } from "../store";

/**
 * Получить реактивный Proxy для хранилища
 *
 * - Значение поля:     `form.passport.number.value`  → string
 * - Запись значения:   `form.passport.number.value = "X"`  → set + notify
 * - Метаданные поля:   `form.passport.number.label` → string | undefined
 *                      `form.passport.number.isVisible` → boolean
 * - Передача ссылки:   `<Child passport={form.passport} />`
 *
 * Компонент перерендерится при ЛЮБОМ изменении в хранилище.
 */
export function useForm<T extends Record<string, any>>(store: ProxyStore<T>): T {
  const subscribe = useCallback(
    (onStoreChange: () => void) => store.subscribe(onStoreChange),
    [store],
  );

  const getSnapshot = useCallback(() => store.getVersion(), [store]);

  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return store.createProxy() as T;
}

