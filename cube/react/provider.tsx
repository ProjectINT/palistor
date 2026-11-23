"use client";

import { createContext, useContext, useMemo, useRef, type ReactElement } from "react";
import type { NotifyFn, Translate } from "../core";
import type { PalistorProviderProps } from "../types";

/** What the nearest `<PalistorProvider>` hands to `usePalistor` and `usePalistorContext`. */
export interface Provided {
  /** Already merged with the providers above. The same object while no key changed. */
  context: Record<string, unknown>;
  translator: Translate | undefined;
  notifier: NotifyFn | undefined;
}

/** No provider, or no `context` anywhere up the tree: one frozen object, so the reference never moves. */
const NO_CONTEXT: Record<string, unknown> = Object.freeze({});

/** @internal Read by usePalistor. */
export const ProvidedContext = createContext<Provided>({ context: NO_CONTEXT, translator: undefined, notifier: undefined });

/** Same keys, same values (`Object.is`). */
function sameKeys(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  if (a === b) return true;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const k of keys) if (!Object.is(a[k], b[k]) || !Object.prototype.hasOwnProperty.call(b, k)) return false;
  return true;
}

/**
 * Shared values for every `usePalistor` store below: `context`, `translator`,
 * `notifier` (all optional). The stores get them in their constructor, so the
 * first render — the server's HTML included — is already translated and its
 * resolvers already see the context; a later change reaches the mounted stores
 * through `usePalistor`'s effect. Stores made with `new Palistor()` are not
 * touched: wire those with `useStoreContext` / `useTranslator` / `useNotifier`.
 *
 * Nested providers add up: the inner one's `context` is merged over the outer
 * one's (shallow, the inner key wins), and a `translator` / `notifier` it does
 * not pass is inherited from the outer one.
 *
 * The context is compared per key, like `store.setContext` does: an inline
 * `context={{ account, navigate }}` with the same values keeps the previous
 * object, so `usePalistorContext` readers do not re-render and no store is
 * touched. Keep the values themselves stable (`navigate` from a router hook,
 * not a new arrow per render).
 *
 * @example
 * ```tsx
 * <PalistorProvider context={{ account, navigate }} translator={t} notifier={toast}>
 *   {children}
 * </PalistorProvider>
 * ```
 */
export function PalistorProvider({ context, translator, notifier, children }: PalistorProviderProps): ReactElement {
  const outer = useContext(ProvidedContext);

  const merged = context ? { ...outer.context, ...context } : outer.context;
  const kept = useRef(merged);
  if (!sameKeys(kept.current, merged)) kept.current = merged;
  const current = kept.current;

  const t = translator ?? outer.translator;
  const notify = notifier ?? outer.notifier;
  const value = useMemo<Provided>(() => ({ context: current, translator: t, notifier: notify }), [current, t, notify]);

  return <ProvidedContext.Provider value={value}>{children}</ProvidedContext.Provider>;
}

/**
 * The `context` of the nearest `<PalistorProvider>` (merged with the providers
 * above it), for a component that needs the same values the stores get. A
 * plain React context read: the component re-renders when a key changes. This
 * is the provider's value, not a store's — a store's own `context` option and
 * later `store.setContext` calls are in `store.context`.
 *
 * Without a provider it is an empty frozen object, the same one every time.
 * `T` is not checked against what the provider was given.
 *
 * @example
 * ```tsx
 * const { account } = usePalistorContext<{ account: Account }>();
 * ```
 */
export function usePalistorContext<T extends object = Record<string, unknown>>(): T {
  return useContext(ProvidedContext).context as T;
}
