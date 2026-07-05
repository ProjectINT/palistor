/**
 * usePersist — React hook wiring persistence into a ProxyStore.
 *
 * Registers the driver and key on mount, disconnects on unmount.
 * Lets you provide a key that is only known in the React context
 * (e.g. from the router or props).
 *
 * @example
 * ```tsx
 * import { usePersist } from "@palistor/react/usePersist";
 * import { localStorageDriver } from "@palistor/store/persist";
 * import { paymentStore } from "./config/appConfig";
 *
 * function PaymentPage({ orderId }: { orderId: string }) {
 *   // The key depends on orderId — known only inside React
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
 * Wires persistence into a ProxyStore from a React component.
 *
 * On mount:
 *   - Calls `store.persist.enable(options)` — hydration + auto-save.
 *
 * On unmount:
 *   - Calls `store.persist.flush()` (final save).
 *   - Calls `store.persist.disable()` — unsubscribes.
 *
 * Reconnects when the key changes.
 *
 * @param store   — a ProxyStore created via new Palistor()
 * @param options — persistence options (key, driver, debounce, …)
 */
export function usePersist<TConfig extends Record<string, any>>(
  store: ProxyStore<TConfig>,
  options: PersistOptions,
): void {
  // Keep options in a ref so the effect isn't recreated on every render
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const opts = optionsRef.current;

    // Enable persist (hydrate + auto-save)
    store.persist.enable(opts);

    return () => {
      // Final save before unmount
      store.persist.flush();
      store.persist.disable();
    };
    // Reconnect when the store or key changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, options.key, options.driver]);
}
