import { Palistor } from "./palistor";

import type { ProxyStoreOptions } from "./types";

export type { FieldState } from "../compute/index";
export type { Resolve, NotifyFn } from "../resolvePipeline";
export type { SubmitResult } from "../submitPipeline/submitPipeline";

// Re-export all public types from the dedicated types module
export type {
  Unsubscribe,
  MaybeComputed,
  DeepPartialValues,
  FieldTypeMeta,
  ConfigNode,
  FieldProxyNode,
  GroupProxyNode,
  ConfigProxy,
  ExtractValues,
  ProxyStoreOptions,
  ProxyStore,
} from "./types";

// Re-export Palistor class
export { Palistor } from "./palistor";

// ─── Фабрика ─────────────────────────────────────────────────────────────────

/**
 * Создать ProxyStore с вычисляемым состоянием.
 *
 * @example
 * const store = createProxyStore({
 *   config: {
 *     email: { value: "", label: "Email", isRequired: true, validate: v => !v ? "required" : undefined },
 *     passport: {
 *       isVisible: (v) => v.paymentType === "bank",
 *       number: { value: "", label: "Passport Number" },
 *     },
 *   },
 *   initialValues: { email: "user@example.com" },
 * });
 *
 * store.proxy.email.value            // → "user@example.com"
 * store.proxy.email.isRequired       // → true
 * store.proxy.email.isInvalid        // → undefined (потому что value не пустой)
 * store.proxy.email.value = ""       // → пересчёт → isInvalid = true
 * store.proxy.passport.isVisible     // → false (paymentType != "bank")
 */
export function createProxyStore<TConfig extends Record<string, any>>(
  options: ProxyStoreOptions<TConfig>,
): Palistor<TConfig> {
  return new Palistor(options);
}


