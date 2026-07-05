/**
 * useStoreContext — registers non-reactive context with a ProxyStore.
 *
 * The context is available in all callbacks (resolve.resolver, onSubmit,
 * onChange, …) via `store.context`. Not part of the form — excluded from
 * getValues(), submit, persist.
 *
 * Used for global variables (accountId, tenant, …) that requests need but
 * that are not form fields.
 *
 * @example
 * ```tsx
 * import { useStoreContext } from 'palistor';
 * import { paymentStore } from './config/appConfig';
 *
 * function Layout({ children }: { children: React.ReactNode }) {
 *   const accountId = useAccountId(); // from the auth provider
 *   useStoreContext(paymentStore, { accountId });
 *   return <>{children}</>;
 * }
 * ```
 *
 * In the config:
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
 * Registers non-reactive context with a ProxyStore.
 *
 * When `ctx` changes — merges the new keys into the existing context.
 *
 * @param store — a ProxyStore created via new Palistor()
 * @param ctx   — an object with arbitrary data (accountId, tenant, …)
 */
export function useStoreContext<TConfig extends Record<string, any>>(
  store: ProxyStore<TConfig>,
  ctx: Record<string, unknown>,
): void {
  useEffect(() => {
    store.setContext(ctx);
  }, [store, ctx]);
}
