/**
 * useNotifier — registers a notification function in ProxyStore.
 *
 * Call once in layout/provider. After registration, resolver `onError`
 * callbacks receive the notifier via `ctx.notify`, enabling React-aware
 * toast/alert notifications from pure config code.
 *
 * @example
 * ```tsx
 * import { useCallback } from 'react';
 * import { useTranslations } from 'next-intl';
 * import { useNotifier } from '@palistor/react/useNotifier';
 * import { paymentStore } from './config/paymentForm';
 *
 * function Layout({ children }: { children: React.ReactNode }) {
 *   const tErrors = useTranslations('Errors');
 *   const notifyError = useCallback((error: any, code?: string) => {
 *     addToast({ title: tErrors(code ?? 'UNKNOWN_ERROR'), color: 'danger' });
 *   }, [tErrors]);
 *
 *   useNotifier(paymentStore, notifyError);
 *   return <>{children}</>;
 * }
 * ```
 */

import { useEffect } from "react";
import type { ProxyStore } from "../store/store";
import type { NotifyFn } from "../store/resolvePipeline/";

/**
 * Registers a notification function in ProxyStore for use in resolver onError.
 *
 * @param store    — ProxyStore created via createProxyStore
 * @param notifier — notification function (toast, alert, etc.)
 */
export function useNotifier<TConfig extends Record<string, any>>(
  store: ProxyStore<TConfig>,
  notifier: NotifyFn,
): void {
  useEffect(() => {
    store.setNotifier(notifier);
    return () => {
      store.setNotifier(null);
    };
  }, [store, notifier]);
}
