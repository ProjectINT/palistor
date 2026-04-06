/**
 * useStoreContext — регистрирует нереактивный контекст в ProxyStore.
 *
 * Контекст доступен во всех callback-ах (resolve.resolver, onSubmit, onChange, …)
 * через `store.context`. Не является частью формы — не попадает в
 * getValues(), submit, persist.
 *
 * Используется для глобальных переменных (accountId, tenant, …),
 * которые нужны в запросах, но не являются полями формы.
 *
 * @example
 * ```tsx
 * import { useStoreContext } from '@projectint/palistor';
 * import { paymentStore } from './config/appConfig';
 *
 * function Layout({ children }: { children: React.ReactNode }) {
 *   const accountId = useAccountId(); // из auth-провайдера
 *   useStoreContext(paymentStore, { accountId });
 *   return <>{children}</>;
 * }
 * ```
 *
 * В конфиге:
 * ```ts
 * resolve: {
 *   resolver: async (values, store) => {
 *     return api.fetchUsers(store.context.accountId);
 *   },
 * }
 * ```
 */

import { useEffect } from "react";
import type { ProxyStore } from "../store/store";

/**
 * Регистрирует нереактивный контекст в ProxyStore.
 *
 * При изменении `ctx` — заменяет контекст целиком.
 * При unmount — очищает контекст (пустой объект).
 *
 * @param store — ProxyStore, созданный через new Palistor()
 * @param ctx   — объект с произвольными данными (accountId, tenant, …)
 */
export function useStoreContext<TConfig extends Record<string, any>>(
  store: ProxyStore<TConfig>,
  ctx: Record<string, unknown>,
): void {
  useEffect(() => {
    store.setContext(ctx);
    return () => {
      store.setContext({});
    };
  }, [store, ctx]);
}
