import type { TranslateFn } from "../store/types";

/**
 * Resolves a string property (label, placeholder, description) from the config.
 * Can be a string or a `(t: TranslateFn, values) => string` function.
 *
 * When a translator is registered, the real resolution happens lazily in the
 * proxy GET trap (buildProxy.ts). Here we keep the fallback: functions are
 * called with identity → the translation key is returned.
 */
export function resolveString(
  configValue: string | ((t: TranslateFn, values: Record<string, any>) => string) | undefined,
  values: Record<string, any> = {},
): string | undefined {
  if (configValue === undefined) return undefined;
  if (typeof configValue === "function") {
    // identity — returns the key as-is (fallback until a translator is registered)
    return configValue((v: string) => v, values);
  }
  return configValue;
}
