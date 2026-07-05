/**
 * useTranslator — registers a translation function with a ProxyStore.
 *
 * Call it once in a layout/provider. Once registered, every component using
 * useForm automatically receives translated label / placeholder / description
 * (when the config defines them as functions).
 *
 * @example
 * ```tsx
 * import { useTranslations } from 'next-intl';
 * import { useTranslator } from '@palistor/react/useTranslator';
 * import { paymentStore } from './config/appConfig';
 *
 * function Layout({ children }: { children: React.ReactNode }) {
 *   const t = useTranslations();
 *   useTranslator(paymentStore, t);
 *   return <>{children}</>;
 * }
 * ```
 *
 * Without a translator — label/placeholder return the translation keys as-is
 * (a fallback, convenient for tests and SSR without i18n).
 */

import { useEffect } from "react";
import type { ProxyStore } from "../store/store";
import type { TranslateFn } from "../store/store/types";

/**
 * Registers a translation function with a ProxyStore.
 *
 * When `translator` changes (e.g. on a locale switch) —
 * all components subscribed via useForm re-render with
 * up-to-date translations.
 *
 * @param store      — a ProxyStore created via new Palistor()
 * @param translator — translation function (next-intl `t`, i18next `t`, …)
 */
export function useTranslator<TConfig extends Record<string, any>>(
  store: ProxyStore<TConfig>,
  translator: TranslateFn,
): void {
  useEffect(() => {
    store.setTranslator(translator);
    return () => {
      store.setTranslator(null);
    };
  }, [store, translator]);
}
