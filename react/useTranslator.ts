/**
 * useTranslator — регистрирует функцию перевода в ProxyStore.
 *
 * Вызывайте один раз в layout/провайдере. После регистрации все компоненты,
 * использующие useForm, автоматически получат переведённые
 * label / placeholder / description (если в конфиге они заданы как функции).
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
 * Без translator — label/placeholder возвращают ключи перевода как есть
 * (fallback, удобно для тестов и SSR без i18n).
 */

import { useEffect } from "react";
import type { ProxyStore } from "../store/store";
import type { TranslateFn } from "../store/store/types";

/**
 * Регистрирует функцию перевода в ProxyStore.
 *
 * При смене `translator` (например, при смене локали) —
 * все подписанные через useForm компоненты перерендерятся
 * с актуальными переводами.
 *
 * @param store      — ProxyStore, созданный через new Palistor()
 * @param translator — функция перевода (next-intl `t`, i18next `t`, …)
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
