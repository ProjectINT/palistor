/**
 * useForm — React хук для подключения к ProxyStore
 *
 * Возвращает реактивный прокси. Доступ к полям через точку — это и есть
 * подписка: компонент перерендерится только при изменении прочитанных полей.
 *
 * @example
 * ```tsx
 * const store = createProxyStore({ config });
 *
 * function App() {
 *   const form = useForm(store);
 *
 *   return (
 *     <div>
 *       <PassportSection passport={form.passport} />
 *       <input
 *         value={form.email.value}
 *         onChange={(e) => { form.email.value = e.target.value }}
 *       />
 *     </div>
 *   );
 * }
 *
 * // Дочерний компонент — НЕ нужен useForm, просто читает из прокси
 * function PassportSection({ passport }) {
 *   if (!passport.isVisible) return null;
 *   return <NumberField field={passport.number} />;
 * }
 * ```
 *
 * Как работает:
 *   1. useSyncExternalStore подписывается на глобальные изменения store.
 *   2. getSnapshot сравнивает версии только прочитанных узлов →
 *      re-render происходит только если изменилось то, что читалось.
 *   3. store.proxy — это уже Proxy. useForm просто возвращает его.
 *      Запись `form.email.value = "X"` → store.proxy.email.value = "X" →
 *      SET trap → formatter → validate → recompute → notify → re-render.
 */

import { useSyncExternalStore, useCallback } from "react";
import type { ProxyStore, ConfigProxy } from "../store/store";

/**
 * Подключает React-компонент к ProxyStore.
 *
 * Компонент перерендерится при ЛЮБОМ изменении в хранилище (через
 * глобальную подписку + version). Это корректно и достаточно для
 * большинства форм (< 100 полей). Оптимизация с tracking-proxy
 * (re-render только по прочитанным полям) — следующий шаг.
 *
 * @param store — ProxyStore, созданный через createProxyStore
 * @returns ConfigProxy — тот же store.proxy, типизированный по конфигу
 */
export function useForm<TConfig extends Record<string, any>>(
  store: ProxyStore<TConfig>,
): ConfigProxy<TConfig> {
  const subscribe = useCallback(
    (onStoreChange: () => void) => store.subscribeGlobal(onStoreChange),
    [store],
  );

  const getSnapshot = useCallback(() => store.getVersion(), [store]);

  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return store.proxy;
}

