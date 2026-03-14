/**
 * usePersist — React хук для подключения персистенции к ProxyStore.
 *
 * Регистрирует драйвер и ключ при маунте, отключает при анмаунте.
 * Позволяет задавать ключ, который известен только в React-контексте
 * (например, из роутера или пропсов).
 *
 * @example
 * ```tsx
 * import { usePersist } from "@palistor/react/usePersist";
 * import { localStorageDriver } from "@palistor/store/persist";
 * import { paymentStore } from "./config/paymentForm";
 *
 * function PaymentPage({ orderId }: { orderId: string }) {
 *   // Ключ зависит от orderId — становится известен только в React
 *   usePersist(paymentStore, {
 *     key: `payment-${orderId}`,
 *     driver: localStorageDriver,
 *     debounce: 500,
 *   });
 *
 *   const form = useForm(paymentStore);
 *   // ...
 * }
 * ```
 */

import { useEffect, useRef } from "react";
import type { ProxyStore } from "../store/store";
import type { PersistOptions } from "../store/persist/types";

/**
 * Подключает персистенцию к ProxyStore из React-компонента.
 *
 * При маунте:
 *   - Вызывает `store.persist.enable(options)` — гидратация + auto-save.
 *
 * При анмаунте:
 *   - Вызывает `store.persist.flush()` (финальное сохранение).
 *   - Вызывает `store.persist.disable()` — отписка.
 *
 * При смене ключа — переподключается.
 *
 * @param store   — ProxyStore, созданный через new Palistor()
 * @param options — опции персистенции (key, driver, debounce, …)
 */
export function usePersist<TConfig extends Record<string, any>>(
  store: ProxyStore<TConfig>,
  options: PersistOptions,
): void {
  // Храним options в ref, чтобы не пересоздавать эффект при каждом рендере
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const opts = optionsRef.current;

    // Включаем persist (hydrate + auto-save)
    store.persist.enable(opts);

    return () => {
      // Финальное сохранение перед размонтированием
      store.persist.flush();
      store.persist.disable();
    };
    // Переподключение при смене store или ключа
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, options.key, options.driver]);
}
